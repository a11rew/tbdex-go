import {
	ArkeselArgs,
	ArkeselResponse,
	BeemArgs,
	BeemResponse,
	HubtelArgs,
	HubtelResponse,
	NaloArgs,
	NaloResponse,
	ProviderResponse,
	SouthPawslArgs,
	SouthPawslResponse,
	UssdGatewayArgs,
} from './types';

export function mapArgsForProvider(
	provider: string,
	args: UssdGatewayArgs | HubtelArgs | NaloArgs | ArkeselArgs | SouthPawslArgs | BeemArgs,
): UssdGatewayArgs {
	switch (provider) {
		case 'hubtel':
		case 'emergent':
		case 'cross-switch':
			return mapHubtelArgs(args as HubtelArgs);
		case 'nalo':
			return mapNaloArgs(args as NaloArgs);
		case 'arkesel':
			return mapArkeselArgs(args as ArkeselArgs);
		case 'southpawsl':
			return mapSouthPawslArgs(args as SouthPawslArgs);
		case 'beem':
			return mapBeemArgs(args as BeemArgs);
		default:
			return args as UssdGatewayArgs;
	}
}

function mapHubtelArgs(args: HubtelArgs): UssdGatewayArgs {
	return {
		sessionId: args.SessionId,
		phoneNumber: `+${args.Mobile}`,
		serviceCode: args.ServiceCode,
		text: args.Type.toLowerCase() === 'initiation' ? parseHubtelInitiationText(args) : args.Message,
	};
}

function mapNaloArgs(args: NaloArgs): UssdGatewayArgs {
	return {
		sessionId: args.MSISDN,
		phoneNumber: `+${args.MSISDN}`,
		serviceCode: args.MSGTYPE ? args.USERDATA : '',
		text: args.MSGTYPE ? parseNaloInitiationText(args) : args.USERDATA,
	};
}

function mapArkeselArgs(args: ArkeselArgs): UssdGatewayArgs {
	return {
		sessionId: args.sessionID,
		phoneNumber: `+${args.msisdn}`,
		serviceCode: '',
		text: args.newSession ? '' : args.userData,
	};
}

function mapSouthPawslArgs(args: SouthPawslArgs): UssdGatewayArgs {
	return {
		sessionId: args.sessionId,
		phoneNumber: `+${args.msisdn}`,
		serviceCode: args.ussdString,
		text: args.ussdString === args.inputOption ? '' : args.inputOption,
	};
}

function mapBeemArgs(args: BeemArgs): UssdGatewayArgs {
	return {
		sessionId: args.session_id,
		phoneNumber: `+${args.msisdn}`,
		serviceCode: args.serviceCode,
		text: args.command.toLowerCase() === 'initiate' ? '' : args.payload.response,
	};
}

function parseHubtelInitiationText(hubtelArgs: HubtelArgs): string {
	const { ServiceCode: serviceCode, Message: text } = hubtelArgs;
	if (text === `*${serviceCode}#`) {
		return '';
	} else {
		const routeStart = serviceCode.length + 2;
		return text.slice(routeStart, -1);
	}
}

function parseNaloInitiationText(naloArgs: NaloArgs): string {
	const { USERDATA: text, USERDATA: serviceCode } = naloArgs;
	if (text === `*${serviceCode}#`) {
		return '';
	} else {
		const routeStart = serviceCode.length + 2;
		return text.slice(routeStart, -1);
	}
}

function parseArkeselInitiationText(arkeselArgs: ArkeselArgs): string {
	const { userData: text, userData: serviceCode } = arkeselArgs;
	if (text === `*${serviceCode}#`) {
		return '';
	} else {
		const routeStart = serviceCode.length + 2;
		return text.slice(routeStart, -1);
	}
}

function parseSouthPawslInitiationText(southPawslArgs: SouthPawslArgs): string {
	const { ussdString: serviceCode, inputOption: text } = southPawslArgs;
	if (text === `*${serviceCode}#`) {
		return '';
	} else {
		const routeStart = serviceCode.length + 2;
		return text.slice(routeStart, -1);
	}
}

export function getRouteForProvider(
	provider: string,
	args: UssdGatewayArgs | HubtelArgs | NaloArgs | ArkeselArgs | SouthPawslArgs | BeemArgs,
	session: any,
): Promise<string> {
	switch (provider) {
		case 'hubtel':
		case 'emergent':
		case 'cross-switch':
			return getHubtelRoute(args as HubtelArgs, session);
		case 'nalo':
			return getNaloRoute(args as NaloArgs, session);
		case 'arkesel':
			return getArkeselRoute(args as ArkeselArgs, session);
		case 'southpawsl':
			return getSouthPawslRoute(args as SouthPawslArgs, session);
		case 'beem':
			return getBeemRoute(args as BeemArgs, session);
		default:
			return Promise.resolve((args as UssdGatewayArgs).text);
	}
}

function getHubtelRoute(args: HubtelArgs, session: any): Promise<string> {
	if (args.Type.toLowerCase() === 'initiation') {
		const route = parseHubtelInitiationText(args);
		return session.set('route', route).then(() => route);
	} else {
		return session.get('route').then((pastRoute: string) => {
			const route = pastRoute ? `${pastRoute}*${args.Message}` : args.Message;
			return session.set('route', route).then(() => route);
		});
	}
}

function getNaloRoute(args: NaloArgs, session: any): Promise<string> {
	if (args.MSGTYPE) {
		const route = parseNaloInitiationText(args);
		return session.set('route', route).then(() => route);
	} else {
		return session.get('route').then((pastRoute: string) => {
			const route = pastRoute ? `${pastRoute}*${args.USERDATA}` : args.USERDATA;
			return session.set('route', route).then(() => route);
		});
	}
}

function getArkeselRoute(args: ArkeselArgs, session: any): Promise<string> {
	if (args.newSession) {
		const route = parseArkeselInitiationText(args);
		return session.set('route', route).then(() => route);
	} else {
		return session.get('route').then((pastRoute: string) => {
			const route = pastRoute ? `${pastRoute}*${args.userData}` : args.userData;
			return session.set('route', route).then(() => route);
		});
	}
}

function getSouthPawslRoute(args: SouthPawslArgs, session: any): Promise<string> {
	if (args.ussdString === args.inputOption) {
		const route = '';
		return session.set('route', route).then(() => route);
	} else {
		return session.get('route').then((pastRoute: string) => {
			const route = pastRoute ? `${pastRoute}*${args.inputOption}` : args.inputOption;
			return session.set('route', route).then(() => route);
		});
	}
}

function getBeemRoute(args: BeemArgs, session: any): Promise<string> {
	if (args.command.toLowerCase() === 'initiate') {
		const route = '';
		return session.set('route', route).then(() => route);
	} else {
		return session.get('route').then((pastRoute: string) => {
			const route = pastRoute ? `${pastRoute}*${args.payload.response}` : args.payload.response;
			return session.set('route', route).then(() => route);
		});
	}
}

export function formatResultForProvider(
	provider: string,
	text: string,
	type: 'con' | 'end',
	args: UssdGatewayArgs | null,
): string | ProviderResponse {
	switch (provider) {
		case 'hubtel':
		case 'emergent':
		case 'cross-switch':
			return formatHubtelResponse(text, type);
		case 'nalo':
			return formatNaloResponse(text, type, args);
		case 'arkesel':
			return formatArkeselResponse(text, type, args);
		case 'southpawsl':
			return formatSouthPawslResponse(text, type, args);
		case 'beem':
			return formatBeemResponse(text, type, args);
		default:
			return `${type.toUpperCase()} ${text}`;
	}
}

function formatHubtelResponse(text: string, type: 'con' | 'end'): HubtelResponse {
	return {
		Message: text,
		Type: type === 'con' ? 'Response' : 'Release',
	};
}

function formatNaloResponse(text: string, type: 'con' | 'end', args: UssdGatewayArgs | null): NaloResponse {
	return {
		MSG: text,
		MSGTYPE: type === 'con',
		USERID: args?.sessionId || '',
		MSISDN: args?.phoneNumber || '',
	};
}

function formatArkeselResponse(text: string, type: 'con' | 'end', args: UssdGatewayArgs | null): ArkeselResponse {
	return {
		message: text,
		continueSession: type === 'con',
		userID: args?.sessionId || '',
		msisdn: args?.phoneNumber || '',
		sessionID: args?.sessionId || '',
	};
}

function formatSouthPawslResponse(text: string, type: 'con' | 'end', args: UssdGatewayArgs | null): SouthPawslResponse {
	return {
		message: text,
		state: type === 'con' ? 'CONTINUE' : 'END',
		menuId: args?.sessionId || '',
		ussdString: args?.serviceCode || '',
		option: args?.text || '',
		ussdParameters: [],
	};
}

function formatBeemResponse(text: string, type: 'con' | 'end', args: UssdGatewayArgs | null): BeemResponse {
	return {
		msisdn: args?.phoneNumber || '',
		operator: '',
		session_id: args?.sessionId || '',
		command: type === 'con' ? 'continue' : 'terminate',
		payload: {
			request_id: '',
			request: text,
		},
	};
}
