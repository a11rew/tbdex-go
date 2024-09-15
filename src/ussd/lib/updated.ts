import { EventEmitter } from 'events';
import { providerLogic } from './providers'; // Import the provider logic

class UssdMenu extends EventEmitter {
	public session: any;
	public provider: UssdMenu.UssdMenuProvider;
	public args: UssdMenu.UssdGatewayArgs;
	public states: { [key: string]: UssdState } = {};
	public result: string = '';
	public val: string = '';
	public onResult?: (
		result: string | UssdMenu.HubtelResponse | UssdMenu.NaloResponse | UssdMenu.ArkeselResponse | UssdMenu.SouthPawslResponse,
	) => void;
	public resolve?: (value: string) => void;

	static START_STATE = '__start__';

	constructor(opts: UssdMenu.UssdMenuOptions = {}) {
		super();
		const validProviders: UssdMenu.UssdMenuProvider[] = [
			'hubtel',
			'africasTalking',
			'emergent',
			'cross-switch',
			'nalo',
			'arkesel',
			'beem',
			'southpawsl',
		];
		this.provider = opts.provider || 'africasTalking';
		if (!validProviders.includes(this.provider)) {
			throw new Error(`Invalid Provider Option: ${this.provider}`);
		}
		this.session = null;
		this.args = {} as UssdMenu.UssdGatewayArgs;
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
		switch (this.provider) {
			case 'hubtel':
				this.result = providerLogic.hubtelCon(text);
				break;
			case 'emergent':
				this.result = providerLogic.emergentCon(text);
				break;
			case 'cross-switch':
				this.result = providerLogic.crossSwitchCon(text);
				break;
			case 'nalo':
				this.result = providerLogic.naloCon(text, this.args);
				break;
			case 'arkesel':
				this.result = providerLogic.arkeselCon(text, this.args);
				break;
			case 'beem':
				this.result = providerLogic.beemCon(text, this.args);
				break;
			case 'southpawsl':
				this.result = providerLogic.southpawslCon(text, this.args, this.val);
				break;
			default:
				this.result = 'CON ' + text;
		}
		this.callOnResult();
	}

	end(text: string): void {
		switch (this.provider) {
			case 'hubtel':
				this.result = providerLogic.hubtelEnd(text);
				break;
			case 'emergent':
				this.result = providerLogic.emergentEnd(text);
				break;
			case 'cross-switch':
				this.result = providerLogic.crossSwitchEnd(text);
				break;
			case 'nalo':
				this.result = providerLogic.naloEnd(text, this.args);
				break;
			case 'arkesel':
				this.result = providerLogic.arkeselEnd(text, this.args);
				break;
			case 'beem':
				this.result = providerLogic.beemEnd(text, this.args);
				break;
			case 'southpawsl':
				this.result = providerLogic.southpawslEnd(text, this.args, this.val);
				break;
			default:
				this.result = 'END ' + text;
		}
		this.callOnResult();
		if (this.session) {
			this.session.end();
		}
	}

	mapArgs(
		args: UssdMenu.UssdGatewayArgs | UssdMenu.HubtelArgs | UssdMenu.NaloArgs | UssdMenu.ArkeselArgs | UssdMenu.SouthPawslArgs,
	): UssdMenu.UssdGatewayArgs {
		switch (this.provider) {
			case 'hubtel':
				return providerLogic.hubtelMapArgs(args);
			case 'emergent':
				return providerLogic.emergentMapArgs(args);
			case 'beem':
				return providerLogic.beemMapArgs(args);
			// Add the logic for other providers similarly.
			default:
				return args;
		}
	}

	getRoute(args: UssdMenu.UssdGatewayArgs): Promise<string> {
		return Promise.resolve(this.args.text);
	}

	run(args: UssdMenu.UssdGatewayArgs, onResult?: Function): Promise<string> {
		this.mapArgs(args);
		this.onResult = onResult;

		const run = () => {
			this.getRoute(args)
				.then((route) => {
					this.resolveRoute(route, (err, state) => {
						if (err) {
							return this.emit('error', new Error(err));
						}
						this.runState(state);
					});
				})
				.catch((err) => {
					return this.emit('error', new Error(err));
				});
		};

		if (this.session) {
			this.session.start().then(run);
		} else {
			run();
		}

		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}

class UssdState {
	public name: string = '';
	public run?: (state: UssdState) => void;
	public defaultNext: string = '';
	public val: string = '';

	constructor(public menu: UssdMenu) {}
}

export = UssdMenu;
