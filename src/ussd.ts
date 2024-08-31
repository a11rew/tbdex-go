import { EventEmitter } from 'node:events';

interface UssdMenuOptions {
	provider?: string;
}

interface UssdStateOptions {
	run: (state: UssdState) => void;
	next?: Record<string, string | ((callback: (nextPath: string) => void) => void | Promise<string>)> | null;
	defaultNext?: string;
}

interface SessionConfig {
	start: (sessionId: string, callback: (err: Error | null, result?: any) => void) => void | Promise<any>;
	get: (sessionId: string, key: string, callback: (err: Error | null, result?: any) => void) => void | Promise<any>;
	set: (sessionId: string, key: string, val: any, callback: (err: Error | null, result?: any) => void) => void | Promise<any>;
	end: (sessionId: string, callback: (err: Error | null, result?: any) => void) => void | Promise<any>;
}

interface UssdArgs {
	sessionId: string;
	phoneNumber: string;
	serviceCode: string;
	text: string;
}

class UssdState {
	menu: UssdMenu;
	name: string | null;
	run: ((state: UssdState) => void) | null;
	defaultNext: string | null;
	val: string | null;
	next: Record<string, string | null | ((callback: (nextPath: string) => void) => void | Promise<string>)> | null;

	constructor(menu: UssdMenu) {
		this.menu = menu;
		this.name = null;
		this.run = null;
		this.defaultNext = null;
		this.val = null;
		this.next = null;
	}
}

class UssdMenu extends EventEmitter {
	private provider: string;
	private session: any;
	private args: UssdArgs | null;
	private states: Record<string, UssdState>;
	private result: string | { Message: string; Type: string };
	private onResult: ((result: any) => void) | null;
	private val: string;
	private resolve: ((value: any) => void) | null;

	constructor(opts: UssdMenuOptions = {}) {
		super();
		const validProviders = ['hubtel', 'africasTalking'];
		this.provider = opts.provider || 'africasTalking';
		if (!validProviders.includes(this.provider)) {
			throw new Error(`Invalid Provider Option: ${this.provider}`);
		}
		this.session = null;
		this.args = null;
		this.states = {};
		this.result = '';
		this.onResult = null;
		this.val = '';
		this.resolve = null;
	}

	private callOnResult(): void {
		if (this.onResult) {
			this.onResult(this.result);
		}
		if (this.resolve) {
			this.resolve(this.result);
		}
	}

	con(text: string): void {
		if (this.provider === 'hubtel') {
			this.result = {
				Message: text,
				Type: 'Response',
			};
		} else {
			this.result = 'CON ' + text;
		}
		this.callOnResult();
	}

	end(text: string): void {
		if (this.provider === 'hubtel') {
			this.result = {
				Message: text,
				Type: 'Release',
			};
		} else {
			this.result = 'END ' + text;
		}

		this.callOnResult();

		if (this.session) {
			this.session.end();
		}
	}

	private testLinkRule(rule: string | RegExp, val: string): boolean {
		if (typeof rule === 'string' && rule[0] === '*') {
			const re = new RegExp(rule.slice(1));
			return re.test(val);
		}
		return rule == val;
	}

	async resolveRoute(route: string): Promise<UssdState> {
		const parts = route === '' ? [] : route.split('*');
		let state = this.states[UssdMenu.START_STATE];

		if (!state.next || Object.keys(state.next).length === 0) {
			if (state.defaultNext) {
				return this.states[state.defaultNext];
			}

			throw new Error('No default next state found');
		}

		if ('' in state.next) {
			parts.unshift('');
		}

		for (const part of parts) {
			let nextFound = false;
			this.val = part;

			for (const [link, next] of Object.entries(state.next || {})) {
				if (!next) continue;

				if (this.testLinkRule(link, part)) {
					let nextPath: string | void | Promise<string>;
					if (typeof next === 'string') {
						nextPath = next;
					} else if (typeof next === 'function') {
						nextPath = await new Promise<string>((resolve) => next(resolve));
					}

					if (typeof nextPath === 'string') {
						state = this.states[nextPath];
						if (!state) {
							throw new Error(`declared state does not exist: ${nextPath}`);
						}
						state.val = part;
						nextFound = true;
						break;
					}
				}
			}

			if (!nextFound && state.defaultNext) {
				state = this.states[state.defaultNext];
				state.val = part;
			}
		}

		return state;
	}

	private runState(state: UssdState): void {
		if (!state.run) {
			this.emit('error', new Error(`run function not defined for state: ${state.name}`));
			return;
		}

		state.run(state);
	}

	go(stateName: string): void {
		const state = this.states[stateName];
		state.val = this.val;
		this.runState(state);
	}

	goStart(): void {
		this.go(UssdMenu.START_STATE);
	}

	sessionConfig(config: SessionConfig): void {
		const makeCb = (resolve: (value: any) => void, reject: (reason?: any) => void, cb?: (err: Error | null, res?: any) => void) => {
			return (err: Error | null, res?: any) => {
				if (err) {
					if (cb) cb(err);
					reject(err);
					this.emit('error', err);
				} else {
					if (cb) cb(null, res);
					resolve(res);
				}
			};
		};

		const resolveIfPromise = (
			p: any,
			resolve: (value: any) => void,
			reject: (reason?: any) => void,
			cb?: (err: Error | null, res?: any) => void
		) => {
			if (p && p.then) {
				p.then((res: any) => {
					if (cb) cb(null, res);
					resolve(res);
				}).catch((err: Error) => {
					if (cb) cb(err);
					reject(err);
					this.emit('error', err);
				});
			}
		};

		this.session = {
			start: (cb?: (err: Error | null, res?: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.start(this.args!.sessionId, makeCb(resolve, reject, cb));
					resolveIfPromise(res, resolve, reject, cb);
				});
			},
			get: (key: string, cb?: (err: Error | null, res?: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.get(this.args!.sessionId, key, makeCb(resolve, reject, cb));
					resolveIfPromise(res, resolve, reject, cb);
				});
			},
			set: (key: string, val: any, cb?: (err: Error | null, res?: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.set(this.args!.sessionId, key, val, makeCb(resolve, reject, cb));
					resolveIfPromise(res, resolve, reject, cb);
				});
			},
			end: (cb?: (err: Error | null, res?: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.end(this.args!.sessionId, makeCb(resolve, reject, cb));
					resolveIfPromise(res, resolve, reject, cb);
				});
			},
		};
	}

	state(name: string, options: UssdStateOptions): UssdMenu {
		const state = new UssdState(this);
		this.states[name] = state;

		state.name = name;
		state.next = options.next || null;
		state.run = options.run;
		state.defaultNext = options.defaultNext || name;

		return this;
	}

	startState(options: UssdStateOptions): UssdMenu {
		return this.state(UssdMenu.START_STATE, options);
	}

	private mapArgs(args: any): void {
		if (this.provider === 'hubtel') {
			this.args = {
				sessionId: args.SessionId,
				phoneNumber: `+${args.Mobile}`,
				serviceCode: args.ServiceCode,
				text: args.Type === 'Initiation' ? this.parseHubtelInitiationText(args) : args.Message,
			};
		} else {
			this.args = args;
		}
	}

	private parseHubtelInitiationText(hubtelArgs: { ServiceCode: string; Message: string }): string {
		const { ServiceCode: serviceCode, Message: text } = hubtelArgs;
		if (text === `*${serviceCode}#`) {
			return '';
		} else {
			const routeStart = serviceCode.length + 2;
			return text.slice(routeStart, -1);
		}
	}

	private async getRoute(args: any): Promise<string> {
		if (this.provider === 'hubtel') {
			if (this.session === null) {
				throw new Error('Session config required for Hubtel provider');
			} else if (args.Type === 'Initiation') {
				const route = this.parseHubtelInitiationText(args);
				await this.session.set('route', route);
				return route;
			} else {
				const pastRoute = await this.session.get('route');
				const route = pastRoute ? `${pastRoute}*${this.args!.text}` : this.args!.text;
				await this.session.set('route', route);
				return route;
			}
		} else {
			return this.args!.text;
		}
	}

	async run(args: any, onResult?: (result: any) => void): Promise<any> {
		this.mapArgs(args);
		this.onResult = onResult || null;

		const run = async () => {
			try {
				const route = await this.getRoute(args);
				const state = await this.resolveRoute(route);
				this.runState(state);
			} catch (err) {
				console.error('Failed to get route:', err);
				this.emit('error', new Error((err as Error).message));
			}
		};

		if (this.session) {
			await this.session.start();
		}
		await run();

		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}

	static START_STATE: string = '__start__';
}

export default UssdMenu;
