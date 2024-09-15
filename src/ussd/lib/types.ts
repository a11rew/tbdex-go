export interface UssdMenuOptions {
	provider?: string;
}

export interface UssdGatewayArgs {
	text: string;
	phoneNumber: string;
	sessionId: string;
	serviceCode: string;
}

export interface HubtelArgs {
	Mobile: string;
	SessionId: string;
	ServiceCode: string;
	Type: 'Initiation' | 'Response' | 'Release' | 'Timeout';
	Message: string;
	Operator: 'Tigo' | 'Airtel' | 'MTN' | 'Vodafone' | 'Safaricom';
	Sequence: number;
	ClientState?: any;
}

export interface NaloArgs {
	USERID: string;
	MSISDN: string;
	MSGTYPE: boolean;
	USERDATA: string;
	NETWORK: 'Tigo' | 'Airtel' | 'MTN' | 'Vodafone' | 'Glo';
}

export interface ArkeselArgs {
	sessionID: string;
	userID: string;
	newSession: boolean;
	msisdn: string;
	userData: string;
	network: 'Tigo' | 'Airtel' | 'AirtelTigo' | 'MTN' | 'Vodafone' | 'Glo';
}

export interface SouthPawslArgs {
	sessionId: string;
	menuId: string;
	ussdState: string;
	ussdString: string;
	ussdParameters: any[];
	possibleAnswers: string;
	msisdn: string;
	inputOption: string;
	network: 'Tigo' | 'Airtel' | 'AirtelTigo' | 'MTN' | 'Vodafone' | 'Glo';
}

export interface BeemArgs {
	msisdn: string;
	operator: string;
	session_id: string;
	command: string;
	serviceCode: string;
	payload: {
		request_id: string;
		response: string;
	};
}

export interface HubtelResponse {
	Type: 'Response' | 'Release';
	Message: string;
}

export interface NaloResponse {
	USERID: string;
	MSISDN: string;
	MSGTYPE: boolean;
	MSG: string;
}

export interface ArkeselResponse {
	sessionID: string;
	userID: string;
	msisdn: string;
	continueSession: boolean;
	message: string;
}

export interface SouthPawslResponse {
	menuId: string;
	ussdString: string;
	option: string;
	state: 'CONTINUE' | 'END';
	ussdParameters: any[];
	message: string;
}

export interface BeemResponse {
	msisdn: string;
	operator: string;
	session_id: string;
	command: 'continue' | 'terminate';
	payload: {
		request_id: string;
		request: string;
	};
}

export type ProviderResponse = HubtelResponse | NaloResponse | ArkeselResponse | SouthPawslResponse | BeemResponse;

export interface UssdStateOptions {
	run: () => void;
	next?: { [key: string]: string | (() => string) } | null;
	defaultNext?: string;
}

export interface UssdSessionConfig {
	start: (sessionId: string, callback?: (err: Error | null, result: any) => void) => Promise<any> | void;
	end: (sessionId: string, callback?: (err: Error | null, result: any) => void) => Promise<any> | void;
	get: (sessionId: string, key: string, callback?: (err: Error | null, result: any) => void) => Promise<any> | void;
	set: (sessionId: string, key: string, value: any, callback?: (err: Error | null, result: any) => void) => Promise<any> | void;
}
