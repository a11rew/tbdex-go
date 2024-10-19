import { buildContinueResponse, buildRunHandler } from '@/ussd/builders';

import { UssdModule } from '..';

const stateId = 'help';

const handler: UssdModule['handler'] = (menu, env, ctx) => {
	menu.state(stateId, {
		run: buildRunHandler(() => {
			buildContinueResponse(menu, 'Help' + '\n\n' + '1. Frequently Asked Questions (FAQs)', {
				back: true,
				exit: true,
			});
		}),
		next: {
			'#': '__exit__',
			'1': `${stateId}.faqs`,
		},
	});

	menu.state(`${stateId}.faqs`, {
		run: buildRunHandler(() => {
			buildContinueResponse(
				menu,
				'Frequently Asked Questions (FAQs)' +
					'\n\n' +
					'1. How do I send money?' +
					'\n' +
					'2. What is a decentralized ID (DID)?' +
					'\n' +
					'3. What is a PFI?' +
					'\n' +
					'4. What is a VC?',
				{
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'1': `${stateId}.faqs.how-do-i-send-money`,
			'2': `${stateId}.faqs.what-is-a-did`,
			'3': `${stateId}.faqs.what-is-a-pfi`,
			'4': `${stateId}.faqs.what-is-a-vc`,
		},
	});

	menu.state(`${stateId}.faqs.how-do-i-send-money`, {
		run: buildRunHandler(() => {
			buildContinueResponse(
				menu,
				'How do I send money?' +
					'\n\n' +
					'Dial the tbDex Go service code to get started.\n' +
					'Create a user account by creating a new DID or importing an existing DID.\n' +
					'Choose the first option "Send Money" to begin.\n' +
					"You will be guided through the process and you will need to provide details such as the amount, the recipient's details, and the PFI you want to use to send the money.\n" +
					'We automatically rank PFI providers based on the speed of the transaction, the cost and the reliability of the PFI. Select the PFI offering that best suits you.\n' +
					'We will submit a request for the quote to the PFI and you will receive a SMS with the final details of the transaction.\n' +
					'You can then accept or decline the quote. If you accept, you will be given instructions on how to complete the transaction.\n' +
					'You will receive a confirmation message once the transaction is successful. You will be able to rate the PFI after the transaction to help us improve our service.',
				{
					withTruncationSupport: true,
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.faqs`,
		},
	});

	menu.state(`${stateId}.faqs.what-is-a-did`, {
		run: buildRunHandler(() => {
			buildContinueResponse(
				menu,
				'What is a DID?' +
					'\n\n' +
					'A DID is a decentralized identifier that uniquely identifies you and your digital assets and allows you to access different services on the internet with one identity.' +
					'\n\n' +
					'Just like your phone number, it is unique to you and you are responsible for it.' +
					'\n\n' +
					'You can bring your existing DID from other platforms or create a new one on our platform.' +
					'\n\n' +
					'We support the did:dht method and allow you to export your DID, complete with private keys, after creation on tbDex Go.',
				{
					withTruncationSupport: true,
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.faqs`,
		},
	});

	menu.state(`${stateId}.faqs.what-is-a-pfi`, {
		run: buildRunHandler(() => {
			buildContinueResponse(
				menu,
				'What is a PFI?' +
					'\n\n' +
					'A PFI (Participating Financial Institution) is a payment facilitator that allows you to send and receive money on the platform.' +
					'\n\n' +
					'PFIs are third party service providers, local or international, that receive money from you through traditional payment channels and remit it to the recipient.' +
					'\n\n' +
					'We support a wide range of PFIs and strive to curate the best of them for you. You can choose the PFI that best suits you based on the speed of the transaction, the cost and the reliability of the PFI.' +
					'\n\n' +
					'Since PFI providers are third parties, we do not have control over their services. We only provide a platform to connect you with them.' +
					'\n\n' +
					'PFIs have to comply with the regulations of the countries they operate in and as such might require you to provide additional information to complete the transaction. This information is handled securely and used to create Verifiable Credentials (VCs) which are associated with your DIDs.' +
					'\n\n' +
					'These VCs are used to verify your identity and comply with the regulations of the countries they operate in.',
				{
					withTruncationSupport: true,
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.faqs`,
		},
	});

	menu.state(`${stateId}.faqs.what-is-a-vc`, {
		run: buildRunHandler(() => {
			buildContinueResponse(
				menu,
				'What is a VC?' +
					'\n\n' +
					'A Verifiable Credential (VC) is a digital credential that allows you to send and receive money on the platform.' +
					'\n\n' +
					'You can create VCs associated with your DIDs when sending money or you can create them elsewhere, import them to the Decentralized Web Node associated with your DID and tbDex Go will use them to complete your transaction.' +
					'\n\n' +
					'VCs are used by PFIs to verify your identity and comply with the regulations of the countries they operate in. Your information is shared on a strict need-to-know basis and only with the PFI that you are initiating a transaction with.',
				{
					withTruncationSupport: true,
					back: true,
					exit: true,
				},
			);
		}),
		next: {
			'#': '__exit__',
			'0': `${stateId}.faqs`,
		},
	});
};

export default {
	id: stateId,
	description: 'Help',
	handler,
} satisfies UssdModule;
