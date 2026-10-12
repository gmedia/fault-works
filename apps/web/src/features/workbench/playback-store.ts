import { create } from "zustand";

interface PlaybackState {
	/** The experiment the playback position belongs to. */
	owner: string | null;
	timeMs: number;
	playing: boolean;
	/** Simulated seconds per real second. */
	speed: number;
	setTime(ms: number): void;
	setPlaying(playing: boolean): void;
	setSpeed(speed: number): void;
	reset(owner: string): void;
}

/** Replay position over a finished run. Only the view moves; the result never changes. */
export const usePlayback = create<PlaybackState>()((set, get) => ({
	owner: null,
	timeMs: 0,
	playing: false,
	speed: 5,
	setTime: (timeMs) => set({ timeMs }),
	setPlaying: (playing) => set({ playing }),
	setSpeed: (speed) => set({ speed }),
	reset: (owner) => {
		if (get().owner !== owner) set({ owner, timeMs: 0, playing: false });
	},
}));
