/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import {
    fromEvent,
    interval,
    merge,
    Subject,
    BehaviorSubject,
    of,
    timer,
    race,
} from "rxjs";
import {
    map,
    filter,
    scan,
    concatMap,
    mergeMap,
    takeUntil,
    tap,
    take,
    delay,
    switchMap,
    timestamp,
} from "rxjs/operators";
import * as Tone from "tone";
import { SampleLibrary } from "./tonejs-instruments";
import { doc } from "prettier";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 200,
    CANVAS_HEIGHT: 400,
} as const;

const Constants = {
    TICK_RATE_MS: 10,
    SONG_NAME: "RockinRobin",
} as const;

const Note = {
    RADIUS: 0.07 * Viewport.CANVAS_WIDTH,
    TAIL_WIDTH: 10,
};

/** User input */

interface Action {
    apply(s: State): State;
}

// I changed the keys to ASKL instead of HJKL (ASKL is more playable in my opinion)
type Key = "KeyA" | "KeyS" | "KeyK" | "KeyL" | "a" | "s" | "k" | "l";

type Event = "keydown" | "keyup" | "keypress";

type Color = "green" | "red" | "blue" | "yellow";

type Note = Readonly<{
    user_played: boolean;
    instrument_name: string;
    velocity: number;
    pitch: number;
    start: number;
    end: number;
}>;

type State = Readonly<{
    time: number; // Current time of the game
    score: number;
    multiplier: number;
    consecutiveHits: number;
    notes: ReadonlyArray<Note>; // This is used to store every single note
    circles: ReadonlyArray<SVGElement>; // Store every single circles SVG
    tails: ReadonlyArray<SVGElement>; // Store every single tails SVG
    noteCircleTail: ReadonlyArray<[Note, SVGElement, SVGElement]>; // Store those that are user_played True in the form of [Note, circle, tail]
    gameEnd: boolean;
}>;

/**
 * Used to show the key you are currently pressing, it has nothing to do with the game
 *
 * @param key key input
 * @param colorClass color to highlight
 */
function showKeys() {
    function showKeyColor(key: Key, colorClass: string) {
        const thisKey = document.getElementById(key);
        if (!thisKey) return;
        const o = (e: Event) =>
            fromEvent<KeyboardEvent>(document, e).pipe(
                filter(({ code }) => code === key),
            );
        o("keydown").subscribe((e) => thisKey.classList.add(colorClass));
        o("keyup").subscribe((_) => thisKey.classList.remove(colorClass));
    }

    showKeyColor("KeyA", "key-green");
    showKeyColor("KeyS", "key-red");
    showKeyColor("KeyK", "key-blue");
    showKeyColor("KeyL", "key-yellow");
}

const initialState: State = {
    time: 0,
    score: 0,
    multiplier: 1,
    consecutiveHits: 0,
    notes: [],
    circles: [],
    tails: [],
    noteCircleTail: [],
    gameEnd: false,
} as const;

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State) => s;

/** Rendering (side effects) */

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGGraphicsElement) => {
    elem.setAttribute("visibility", "visible");
    elem.parentNode!.appendChild(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGGraphicsElement | SVGElement) =>
    elem.setAttribute("visibility", "hidden");

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
) => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * This is the function called on page load. Your main game loop
 * should be called here.
 */
export function main(
    csvContents: string,
    samples: { [key: string]: Tone.Sampler },
) {
    // Canvas elements
    const svg = document.querySelector("#svgCanvas") as SVGGraphicsElement &
        HTMLElement;
    const preview = document.querySelector(
        "#svgPreview",
    ) as SVGGraphicsElement & HTMLElement;
    const gameover = document.querySelector("#gameOver") as SVGGraphicsElement &
        HTMLElement;
    const container = document.querySelector("#main") as HTMLElement;

    svg.setAttribute("height", `${Viewport.CANVAS_HEIGHT}`);
    svg.setAttribute("width", `${Viewport.CANVAS_WIDTH}`);

    // Text fields
    const multiplier = document.querySelector("#multiplierText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;
    const highScoreText = document.querySelector(
        "#highScoreText",
    ) as HTMLElement;

    /** User input
     *
     * I created two ways to take user input, one just take keypress while the other take keydown until keyup.
     * The first one is more user friendly, but the sound it produce in the tails part is weirder as the speed of emitting increases over time
     * The second one is less user friendly as you have to press and release really quick for notes without tail, but it is more stable when there
     * are tails as the speed of emitting values are constant
     *
     * @param keycode key input
     * @param c the color of the key input
     * @returns an observable that emits new HitOrMiss object
     */

    const key$ = fromEvent<KeyboardEvent>(document, "keypress");

    const fromKey = (keyCode: Key, c: Color) =>
        key$.pipe(
            filter(({ code }) => code === keyCode),
            map((_) => new HitOrMiss(c)),
        );

    // const keyDown$ = fromEvent<KeyboardEvent>(document, "keydown");
    // const keyUp$ = fromEvent<KeyboardEvent>(document, "keyup");

    // const fromKey = (keyCode: Key, c: Color) =>
    //     keyDown$.pipe(
    //         filter(({ code }) => code === keyCode),
    //         switchMap(() =>
    //             interval(10).pipe(
    //                 map(() => new HitOrMiss(c)),
    //                 takeUntil(
    //                     keyUp$.pipe(filter(({ code }) => code === keyCode)),
    //                 ),
    //             ),
    //         ),
    //     );

    /**
     * This are all observable that emits new HitOrMiss with their own color when their own keys are pressed (ASKL)
     */
    const greenKey$ = fromKey("KeyA", "green"); // keyA = green column
    const redKey$ = fromKey("KeyS", "red"); // keyS = red column
    const blueKey$ = fromKey("KeyK", "blue"); // keyK = blue column
    const yellowKey$ = fromKey("KeyL", "yellow"); // keyL = yellow column

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS);

    /**
     * This is a function used to convert all the data in the csv file into an array of note type
     * It is a helper function that will be used by addNotes function
     * @param csvContents the file of the csv
     * @returns Note[] an array of note type
     */
    const csvToNote: (csvContents: string) => Note[] = (csvContents) => {
        return csvContents
            .split("\n")
            .slice(1)
            .map((line) => {
                const [
                    user_played,
                    instrument_name,
                    velocity,
                    pitch,
                    start,
                    end,
                ] = line.split(",");
                const note: Note = {
                    user_played: user_played === "True" ? true : false,
                    instrument_name: String(instrument_name),
                    velocity: Number(velocity) / 127,
                    pitch: Number(pitch),
                    start: Number(start),
                    end: Number(end),
                };
                return note;
            });
    };

    /**
     * This function is used to get the color or column of a note, where it works by 1,5,9.... is green and.....
     * @param pitch the pitch of the note in number
     * @returns a string of color
     */
    const getColor = (pitch: number): string => {
        const color = (pitch % 4) + 1;
        switch (color) {
            case 1:
                return "green";
            case 2:
                return "red";
            case 3:
                return "blue";
            default:
                return "yellow";
        }
    };

    /**
     * This function is used to convert notes into circle and tails to load up the current state
     * Will also be added to noteCircleTail array if user_played is true
     * @param state the state after updating with notes
     * @returns circle array, tail array, noteCircleTail array
     */
    const addSVGHelper = (state: State) => {
        const newSVGs = state.notes.map((note) => {
            const noteColor = getColor(note.pitch);
            const duration = note.end - note.start;

            const circle = createSvgElement(svg.namespaceURI, "circle", {
                r: `${Note.RADIUS}`,
                cx:
                    noteColor === "green"
                        ? "20%"
                        : noteColor === "red"
                          ? "40%"
                          : noteColor === "blue"
                            ? "60%"
                            : "80%",
                cy: "0",
                style: `fill: ${noteColor}`,
                class: "shadow",
            });
            const tail = createSvgElement(svg.namespaceURI, "rect", {
                x:
                    noteColor === "green"
                        ? "16.5%"
                        : noteColor === "red"
                          ? "36.5%"
                          : noteColor === "blue"
                            ? "56.5%"
                            : "76.5%",
                y: "0",
                width: `${Note.RADIUS}`,
                height: `${duration * 175}`,
                style: `fill: ${noteColor};
                        opacity: 0.5;
                        stroke: none`,
                class: "shadow",
            });
            const nCT = note.user_played
                ? ([note, circle, tail] as [Note, SVGElement, SVGElement])
                : undefined;

            return { circle, tail, nCT };
        });
        const circle = newSVGs.map(({ circle }) => circle);
        const tail = newSVGs.map(({ tail }) => tail);
        const nCT = newSVGs
            .map(({ nCT }) => nCT)
            .filter(
                (nct): nct is [Note, SVGElement, SVGElement] =>
                    nct !== undefined,
            ); // This is used to filter out those that are undefined (undefined is when user_played is false)
        return { circle, tail, nCT };
    };

    /**
     * This function is used to update the initialstate into a more complete state to start game
     * where initially the note array is empty and will be filled by this function
     * @param notes the array of notes returned by csvToNote function
     * @param state the initialstate where everything is empty
     * @returns an updated state
     */
    const addNotes = (notes: Note[], state: State): State => {
        return {
            ...state,
            notes: [...state.notes, ...notes],
        };
    };

    /**
     * This function will be used to update the state after being filled with notes
     * The state after this step is ready for the game to be started
     * @param s the state with notes
     * @returns an updated states with note, circle, tail and noteCircleTail array not being empty
     */
    const addSVGs = (s: State): State => {
        const { circle, tail, nCT } = addSVGHelper(s);
        return {
            ...s,
            circles: [...s.circles, ...circle],
            tails: [...s.tails, ...tail],
            noteCircleTail: [...s.noteCircleTail, ...nCT],
        };
    };

    /**
     * This function is used to play a random note when there are no note to be pressed but user input is presence
     * Another word to say is to punish mistakes
     */
    const playRandomNote = () => {
        const duration = randomNumberGenerator.next();
        const pitch = randomNumberGenerator.next() * (127 - 1) + 1;
        const velocity = randomNumberGenerator.next();
        samples["violin"].triggerAttackRelease(
            Tone.Frequency(pitch, "midi").toNote(),
            duration,
            undefined,
            velocity,
        );
    };

    /**
     * A pure number generator class
     */
    class pRNG {
        private static modulus = 0x80000000;
        private static multiplier = 1103515245;
        private static increment = 12345;
        private current: number;

        constructor(public readonly seed: number) {
            this.current = seed;
        }

        // to generate the a new random number
        public next(): number {
            this.current = pRNG.hash(this.current);
            return pRNG.scale(this.current);
        }

        public static hash = (seed: number) =>
            (pRNG.multiplier * seed + pRNG.increment) % pRNG.modulus;

        //to ensure the value is between 0 - 1
        public static scale = (hash: number) => hash / (pRNG.modulus - 1);
    }

    // initializing a number generator, start with the seed 0
    const randomNumberGenerator = new pRNG(0);

    /**
     * This class is about the appearance, movement and deletion of circle and tail SVG
     * User input is not here, only animation of SVG
     * Will also keep on updating the state in to the latest state
     */
    class Render implements Action {
        constructor(public readonly elapsed: number) {}
        apply(s: State): State {
            const newStateCircles: SVGElement[] = []; // These are the arrays of those that are not yet being removed (havent been played yet)
            const newStateNotes: Note[] = [];
            const newStateTails: SVGElement[] = [];
            const newStateNCT: [Note, SVGElement, SVGElement][] = [];
            const miss = []; // To check if there are any user_played true notes that are not played by player
            s.notes.forEach((note, index) => {
                // looping every single note (that are still available) to decide their motion
                const circle = s.circles[index];
                const tail = s.tails[index];
                const duration = note.end - note.start;
                const noteActualStartTime = Math.ceil(note.start * 100);

                // If falls into here the circle should be appended to start coming down for the next loop
                if (s.time === noteActualStartTime) {
                    svg.appendChild(circle);
                    if (duration >= 1) {
                        svg.appendChild(tail);
                        tail.setAttribute("y", String(-(duration * 175)));
                    }
                    if (!note.user_played) {
                        hide(circle);
                        hide(tail);
                    }
                    // If falls here it means that they have already been appended into the canvas, should start moving
                } else if (s.time >= noteActualStartTime) {
                    const cyCircle = circle.getAttribute("cy");
                    circle.setAttribute("cy", String(Number(cyCircle) + 1.75));

                    const cyTail = Number(tail.getAttribute("y")) + 1.75;
                    tail.setAttribute("y", String(cyTail));
                }
                if (note.user_played === false) {
                    if (Number(circle.getAttribute("cy")) === 327.25) {
                        // its time to play the note
                        samples[note.instrument_name].triggerAttackRelease(
                            Tone.Frequency(note.pitch, "midi").toNote(),
                            note.end - note.start,
                            undefined,
                            note.velocity,
                        );
                        svg.removeChild(circle); // no point adding back into the arrays as it has already done its job
                    } else {
                        // adding everything back to their array as they are not done yet
                        newStateCircles.push(circle);
                        newStateNotes.push(note);
                        newStateTails.push(tail);
                    }
                } else if (note.user_played === true) {
                    if (Number(circle.getAttribute("cy")) > 380) {
                        // the note falls out of pressing range (cant be pressed anymore)
                        hide(circle);
                        miss.push(true); // it is a miss
                        const cHeightTail = Number(tail.getAttribute("height"));
                        const cy = tail.getAttribute("y");
                        if (Number(cy) <= 500) {
                            newStateCircles.push(circle);
                            newStateNotes.push(note);
                            newStateTails.push(tail);
                            newStateNCT.push([note, circle, tail]);
                        } else {
                            svg.removeChild(circle);
                        }
                    } else {
                        // havent reach, so added back into their array
                        newStateCircles.push(circle);
                        newStateNotes.push(note);
                        newStateTails.push(tail);
                        newStateNCT.push([note, circle, tail]);
                    }
                }
            });
            // updating text content is called here as this class is being created frequently
            multiplier.textContent = String(s.multiplier);
            scoreText.textContent = String(s.score);
            highScoreText.textContent = String(s.consecutiveHits);
            return {
                ...s,
                time: this.elapsed,
                notes: newStateNotes,
                circles: newStateCircles, // replacing with a new array (as there could be removal of items)
                tails: newStateTails,
                noteCircleTail: newStateNCT,
                multiplier: miss.length >= 1 ? 1 : s.multiplier, // to check if there are missed notes
                consecutiveHits: miss.length >= 1 ? 0 : s.consecutiveHits,
                gameEnd: s.notes.length >= 1 ? false : true, // there are no more notes, game is done
            };
        }
    }

    /**
     * This class is for user actions, playing sounds when it should be and random note when wrong timing
     * Will also update the state
     */
    class HitOrMiss implements Action {
        constructor(public readonly color: Color) {}

        /**
         * This is a function called to play all the notes in the playableNotes array
         * @param playableNotes the array of items to be played
         * @param removedNotes to be appended as this will be used to update the latest state
         * @param removedCircles to be appended as this will be used to update the latest state
         * @param removedTails to be appended as this will be used to update the latest state
         */
        playableNotesLoop(
            playableNotes: Array<[Note, SVGElement, SVGElement]>,
            removedNotes: Note[],
            removedCircles: SVGElement[],
            removedTails: SVGElement[],
        ) {
            playableNotes.forEach((nCT) => {
                const note = nCT[0];
                const circle = nCT[1];
                const tail = nCT[2];
                samples[note.instrument_name].triggerAttackRelease(
                    Tone.Frequency(note.pitch, "midi").toNote(),
                    note.end - note.start,
                    undefined,
                    note.velocity,
                );
                svg.removeChild(circle);
                removedNotes.push(note);
                removedCircles.push(circle);
                removedTails.push(tail);
            });
        }

        /**
         * This function is made for tails (when there are tails left random note will not be played)
         * @param leftoverTails tails to be updated
         * @param removedNotes to be appended as this will be used to update the latest state
         * @param removedCircles to be appended as this will be used to update the latest state
         * @param removedTails to be appended as this will be used to update the latest state
         * @param s the current state
         */
        leftoverTailsLoop(
            leftoverTails: Array<[Note, SVGElement, SVGElement]>,
            removedNotes: Note[],
            removedCircles: SVGElement[],
            removedTails: SVGElement[],
            s: State,
        ) {
            leftoverTails.forEach((nCT) => {
                const note = nCT[0];
                const circle = nCT[1];
                const tail = nCT[2];
                const from = Math.ceil((note.start + 2) * 100) - 41; // accepting range of pressing
                const end1 = Math.ceil((note.end + 2) * 100) - 20; // accepting range of releasing
                const end2 = Math.ceil((note.end + 2) * 100) + 20; // accepting range of releasing
                if (s.time >= from && s.time <= end1) {
                    // This is used to modify the height of the tail, rectangle does not work the same as circle so this is more complicated
                    const cyTail = Number(tail.getAttribute("y"));
                    const cHeightTail = Number(tail.getAttribute("height"));
                    if (cyTail + cHeightTail > 327.25) {
                        const extra = cyTail + cHeightTail - 327.25;
                        const newHeight = Math.max(0, cHeightTail - extra);
                        tail.setAttribute("height", String(newHeight));
                    }
                    samples[note.instrument_name].triggerAttack(
                        Tone.Frequency(note.pitch, "midi").toNote(),
                        undefined,
                        note.velocity,
                    );
                    timer((note.end + 1.75) * 100 - s.time).subscribe(() => {
                        samples[note.instrument_name].triggerRelease(
                            Tone.Frequency(note.pitch, "midi").toNote(),
                        );
                    });
                } else if (s.time >= end1 && s.time <= end2) {
                    // the tail has ended and can be removed now
                    samples[note.instrument_name].triggerRelease(
                        Tone.Frequency(note.pitch, "midi").toNote(),
                    );
                    svg.removeChild(circle);
                    svg.removeChild(tail);
                    removedNotes.push(note);
                    removedCircles.push(circle);
                    removedTails.push(tail);
                }
            });
        }

        apply(s: State): State {
            const playableNotes: Array<[Note, SVGElement, SVGElement]> = [];
            const leftoverTails: Array<[Note, SVGElement, SVGElement]> = [];
            // This loop is used to fill up the playableNotes and leftoverTails array
            for (let i = 0; i < s.noteCircleTail.length; i++) {
                const nCT = s.noteCircleTail[i];
                const note = nCT[0];
                const circle = nCT[1];
                const tail = nCT[2];
                const circleColor = getColor(note.pitch);
                const from = Math.ceil((note.start + 2) * 100) - 41;
                const to = Math.ceil((note.start + 2) * 100) + 7;
                const duration = note.end - note.start;

                // To check if the note is playable or not
                if (
                    s.time >= from &&
                    s.time <= to &&
                    circleColor === this.color
                ) {
                    if (duration >= 1) {
                        leftoverTails.push([note, circle, tail]);
                    } else {
                        playableNotes.push([note, circle, tail]);
                    }
                    // another loop right here is used to find those that have the same timing as the one found before,
                    // they are hiding at the back of the circle before
                    for (let j = i + 1; j < s.noteCircleTail.length; j++) {
                        const nCT2 = s.noteCircleTail[j];
                        const note2 = nCT2[0];
                        const circle2 = nCT2[1];
                        const tail2 = nCT2[2];
                        const circleColor2 = getColor(note2.pitch);
                        const from2 = Math.ceil((note2.start + 2) * 100) - 41;
                        const to2 = Math.ceil((note2.start + 2) * 100) + 7;
                        const duration2 = note2.end - note2.start;

                        if (
                            from === from2 &&
                            to === to2 &&
                            circleColor === circleColor2 &&
                            duration < 1
                        ) {
                            if (duration2 >= 1) {
                                leftoverTails.push([note2, circle2, tail2]);
                            } else {
                                playableNotes.push([note2, circle2, tail2]);
                            }
                        }
                    }
                    break; // break here because at most we need to find is one
                    // if there are no notes to be played there could be still tails on the svg
                } else if (
                    s.time > to &&
                    circleColor === this.color &&
                    duration >= 1
                ) {
                    leftoverTails.push([note, circle, tail]);
                }
            }

            // this three removed arrays are used by state arrays to filter them out, if there are any
            const removedNotes: Note[] = [];
            const removedCircles: SVGElement[] = [];
            const removedTails: SVGElement[] = [];
            this.playableNotesLoop(
                playableNotes,
                removedNotes,
                removedCircles,
                removedTails,
            );
            this.leftoverTailsLoop(
                leftoverTails,
                removedNotes,
                removedCircles,
                removedTails,
                s,
            );
            // when player pressed for nothing
            if (leftoverTails.length === 0 && playableNotes.length === 0) {
                playRandomNote(); // play a random note as punishment
                return {
                    ...s,
                    multiplier: 1, // will be resetted
                    consecutiveHits: 0, // same goes to you
                };
                // when player pressed for something
            } else {
                const consecutiveHitsAfter =
                    s.consecutiveHits + playableNotes.length;
                // the multiplier calculation is more complicated because there are cases when consecutive hits goes from 9 - 11, skipping 10
                // parse float to get a 2 decimal places, sometimes it could go to more than 10 decimal places
                const multiplierAfter =
                    Math.floor(consecutiveHitsAfter / 10) >
                    Math.floor(s.consecutiveHits / 10)
                        ? parseFloat((s.multiplier + 0.2).toFixed(2))
                        : s.multiplier;
                const scoreAfter = parseFloat(
                    (
                        s.score +
                        (playableNotes.length + leftoverTails.length) *
                            multiplierAfter
                    ).toFixed(2),
                );
                return {
                    ...s,
                    notes: s.notes.filter(
                        // they are now being removed
                        (note) => !removedNotes.includes(note),
                    ),
                    circles: s.circles.filter(
                        // same goes to you
                        (circle) => !removedCircles.includes(circle),
                    ),
                    tails: s.tails.filter(
                        // to you
                        (tail) => !removedTails.includes(tail),
                    ),
                    noteCircleTail: s.noteCircleTail.filter(
                        // and to you
                        (nCT) => !playableNotes.includes(nCT),
                    ),
                    score: scoreAfter,
                    multiplier: multiplierAfter,
                    consecutiveHits: consecutiveHitsAfter,
                };
            }
        }
    }

    const reduceState = (s: State, action: Action) => action.apply(s); // to update the state

    const stateAfterNotes = addNotes(csvToNote(csvContents), initialState);
    const stateAfterSVGs = addSVGs(stateAfterNotes);
    const game$ = tick$.pipe(map((elapsed) => new Render(elapsed))); // keep on updating the game
    const action$ = merge(game$, greenKey$, redKey$, blueKey$, yellowKey$);
    const state$ = action$
        .pipe(scan(reduceState, stateAfterSVGs)) // stateAfterSVGs is now the real "initialstate"
        .subscribe((s: State) => {
            if (s.gameEnd) {
                show(gameover);
                state$.unsubscribe();
            } else {
                hide(gameover);
            }
        });
}

// The following simply runs your main function on window load.  Make sure to leave it in p lace.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    // Load in the instruments and then start your game!
    const samples = SampleLibrary.load({
        instruments: [
            "bass-electric",
            "bassoon",
            "cello",
            "clarinet",
            "contrabass",
            "flute",
            "french-horn",
            "guitar-acoustic",
            "guitar-electric",
            "guitar-nylon",
            "haromonium",
            "harp",
            "organ",
            "piano",
            "saxophone",
            "trombone",
            "trumpet",
            "tuba",
            "violin",
            "xylophone",
        ], // SampleLibrary.list,
        baseUrl: "newsamples/",
    });

    // i added a choice to choose the song we want to play, choose by button on html
    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll("#songSelection button").forEach((button) => {
            button.addEventListener("click", (event) => {
                const song = (event.target as HTMLButtonElement).dataset.song;
                if (song) {
                    const startGame = (contents: string) => {
                        document.body.addEventListener(
                            "mousedown",
                            function () {
                                showKeys();
                                main(contents, samples);
                                console.log("done");
                            },
                            { once: true },
                        );
                    };
                    const { protocol, hostname, port } = new URL(
                        import.meta.url,
                    );
                    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;

                    Tone.ToneAudioBuffer.loaded().then(() => {
                        for (const instrument in samples) {
                            samples[instrument].toDestination();
                            samples[instrument].release = 0.5;
                        }

                        fetch(`${baseUrl}/assets/${song}.csv`)
                            .then((response) => response.text())
                            .then((text) => {
                                startGame(text);

                                const songSelection =
                                    document.querySelector("#songSelection");
                                if (songSelection) {
                                    songSelection.remove();
                                }
                            })
                            .catch((error) =>
                                console.error(
                                    "Error fetching the CSV file:",
                                    error,
                                ),
                            );
                    });
                }
            });
        });
    });
}
