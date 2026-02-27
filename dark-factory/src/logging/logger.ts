export class Logger {
	private startTime: number;
	private stdout: (msg: string) => void;
	private stderr: (msg: string) => void;

	constructor(stdout?: (msg: string) => void, stderr?: (msg: string) => void) {
		this.startTime = Date.now();
		this.stdout = stdout ?? ((msg) => console.log(msg));
		this.stderr = stderr ?? ((msg) => console.error(msg));
	}

	private formatElapsed(elapsedSec: number): string {
		const h = Math.floor(elapsedSec / 3600);
		const m = Math.floor((elapsedSec % 3600) / 60);
		const s = elapsedSec % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}

	private ts(): string {
		const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
		return this.formatElapsed(elapsed);
	}

	log(msg: string): void {
		this.stdout(`[${this.ts()}] ${msg}`);
	}

	ok(msg: string): void {
		this.stdout(`[${this.ts()}] OK: ${msg}`);
	}

	warn(msg: string): void {
		this.stdout(`[${this.ts()}] WARN: ${msg}`);
	}

	err(msg: string): void {
		this.stderr(`[${this.ts()}] ERROR: ${msg}`);
	}
}
