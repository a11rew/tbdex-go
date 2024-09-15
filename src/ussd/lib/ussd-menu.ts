import { EventEmitter } from 'events';
import { formatResultForProvider, getRouteForProvider, mapArgsForProvider } from './providers';
import {
	ArkeselArgs,
	HubtelArgs,
	NaloArgs,
	ProviderResponse,
	SouthPawslArgs,
	UssdGatewayArgs,
	UssdMenuOptions,
	UssdSessionConfig,
	UssdStateOptions,
} from './types';

class UssdState {
	menu: UssdMenu;
	name: string | null = null;
	run: (() => void) | null = null;
	defaultNext: string | null = null;
	next: { [key: string]: string | (() => string) } | null | undefined = null;
	val: string | null = null;

	constructor(menu: UssdMenu) {
		this.menu = menu;
	}
}

class UssdMenu extends EventEmitter {
	static START_STATE = '__start__';

	session: any;
	provider: string;
	args: UssdGatewayArgs | null = null;
	states: { [key: string]: UssdState } = {};
	result: string | ProviderResponse = '';
	val: string = '';
	resolve: ((value: string | ProviderResponse) => void) | null = null;
	onResult: ((result: string | ProviderResponse) => void) | null = null;

	constructor(opts: UssdMenuOptions = {}) {
		super();
		const validProviders = ['hubtel', 'africasTalking', 'emergent', 'cross-switch', 'nalo', 'arkesel', 'beem', 'southpawsl'];
		this.provider = opts.provider || 'africasTalking';
		if (!validProviders.includes(this.provider)) {
			throw new Error(`Invalid Provider Option: ${this.provider}`);
		}
	}

	callOnResult(): void {
		if (this.onResult) {
			this.onResult(this.result);
		}
		if (this.resolve) {
			this.resolve(this.result);
		}
	}

	con(text: string): void {
		this.result = formatResultForProvider(this.provider, text, 'con', this.args);
		this.callOnResult();
	}

	end(text: string): void {
		this.result = formatResultForProvider(this.provider, text, 'end', this.args);
		this.callOnResult();
		if (this.session) {
			this.session.end();
		}
	}

	testLinkRule(rule: string | RegExp, val: string): boolean {
		if (typeof rule === 'string' && rule[0] === '*') {
			const re = new RegExp(rule.substr(1));
			return re.test(val);
		}
		return rule === val;
	}

	resolveRoute(route: string, callback: (err: Error | null, state: UssdState | null) => void): void {
		const parts = route === '' ? [] : route.split('*');
		let state = this.states[UssdMenu.START_STATE];

		if (!state.next || Object.keys(state.next).length === 0) {
			return callback(null, this.states[state.defaultNext!]);
		}

		if ('' in state.next) {
			parts.unshift('');
		}

		const processNextState = (index: number) => {
			if (index >= parts.length) {
				return callback(null, state);
			}

			const part = parts[index];
			this.val = part;
			let nextFound = false;

			for (const [link, next] of Object.entries(state.next || {})) {
				if (this.testLinkRule(link, part)) {
					let nextPath: string | undefined;

					if (typeof next === 'string') {
						nextPath = next;
					} else if (typeof next === 'function') {
						nextPath = next();
					}

					if (nextPath) {
						state = this.states[nextPath];
						if (!state) {
							return callback(new Error(`Declared state does not exist: ${nextPath}`), null);
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

			processNextState(index + 1);
		};

		processNextState(0);
	}

	runState(state: UssdState): void {
		if (!state.run) {
			this.emit('error', new Error(`Run function not defined for state: ${state.name}`));
			return;
		}
		state.run();
	}

	go(stateName: string): void {
		const state = this.states[stateName];
		state.val = this.val;
		this.runState(state);
	}

	goStart(): void {
		this.go(UssdMenu.START_STATE);
	}

	sessionConfig(config: UssdSessionConfig): void {
		this.session = {
			start: (cb?: (err: Error | null, res: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.start(this.args!.sessionId, (err, result) => {
						if (err) {
							if (cb) cb(err, null);
							reject(err);
							this.emit('error', err);
						} else {
							if (cb) cb(null, result);
							resolve(result);
						}
					});
					if (res instanceof Promise) {
						res.then(resolve).catch(reject);
					}
				});
			},
			get: (key: string, cb?: (err: Error | null, res: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.get(this.args!.sessionId, key, (err, result) => {
						if (err) {
							if (cb) cb(err, null);
							reject(err);
							this.emit('error', err);
						} else {
							if (cb) cb(null, result);
							resolve(result);
						}
					});
					if (res instanceof Promise) {
						res.then(resolve).catch(reject);
					}
				});
			},
			set: (key: string, val: any, cb?: (err: Error | null, res: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.set(this.args!.sessionId, key, val, (err, result) => {
						if (err) {
							if (cb) cb(err, null);
							reject(err);
							this.emit('error', err);
						} else {
							if (cb) cb(null, result);
							resolve(result);
						}
					});
					if (res instanceof Promise) {
						res.then(resolve).catch(reject);
					}
				});
			},
			end: (cb?: (err: Error | null, res: any) => void) => {
				return new Promise((resolve, reject) => {
					const res = config.end(this.args!.sessionId, (err, result) => {
						if (err) {
							if (cb) cb(err, null);
							reject(err);
							this.emit('error', err);
						} else {
							if (cb) cb(null, result);
							resolve(result);
						}
					});
					if (res instanceof Promise) {
						res.then(resolve).catch(reject);
					}
				});
			},
		};
	}

	state(name: string, options: UssdStateOptions): UssdMenu {
		const state = new UssdState(this);
		this.states[name] = state;

		state.name = name;
		state.next = options.next;
		state.run = options.run;
		state.defaultNext = options.defaultNext || name;

		return this;
	}

	startState(options: UssdStateOptions): UssdMenu {
		return this.state(UssdMenu.START_STATE, options);
	}

	mapArgs(args: UssdGatewayArgs | HubtelArgs | NaloArgs | ArkeselArgs | SouthPawslArgs): void {
		this.args = mapArgsForProvider(this.provider, args);
	}

	getRoute(args: UssdGatewayArgs | HubtelArgs | NaloArgs | ArkeselArgs | SouthPawslArgs): Promise<string> {
		return getRouteForProvider(this.provider, args, this.session);
	}

	run(
		args: UssdGatewayArgs | HubtelArgs | NaloArgs | ArkeselArgs | SouthPawslArgs,
		onResult?: (result: string | ProviderResponse) => void,
	): Promise<string | ProviderResponse> {
		this.mapArgs(args);
		this.onResult = onResult || null;

		const runMenu = () => {
			this.getRoute(args)
				.then((route) => {
					this.resolveRoute(route, (err, state) => {
						if (err) {
							return this.emit('error', err);
						}
						if (state) {
							this.runState(state);
						}
					});
				})
				.catch((err) => {
					console.error('Failed to get route:', err);
					return this.emit('error', err);
				});
		};

		if (this.session) {
			this.session.start().then(runMenu);
		} else {
			runMenu();
		}

		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}

export default UssdMenu;
