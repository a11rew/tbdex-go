import UssdMenu, { UssdStateOptions } from 'ussd-builder';

type Field<T extends Record<string, string>> = {
	key: keyof T;
	label: string;
};

// Function that given a  list of required fields, builds a menu that asks for those fields
// The menu should be in a loop, asking for each field until all are provided
export async function buildFormMenu<T extends Record<string, string>>(
	menu: UssdMenu,
	formKey: string,
	fields: Field<T>[],
	onSubmit: (form: T) => Promise<string>,
) {
	// Create session storage for the form if it doesn't exist
	const formValuesInSession = await menu.session.get(formKey);
	if (!formValuesInSession) {
		await menu.session.set(formKey, {});
	}

	let entryPoint = `${formKey}.${String(fields[0].key)}`;

	// Field values are stored in the session
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];

		menu.state(`${formKey}.${String(field.key)}`, {
			run: () => {
				menu.con(field.label);
			},

			next: {
				'*': async () => {
					const formValuesInSession = JSON.parse(await menu.session.get(formKey)) as T;
					await menu.session.set(formKey, {
						...formValuesInSession,
						[field.key]: menu.val,
					});

					if (i === fields.length - 1) {
						const form = JSON.parse(await menu.session.get(formKey)) as T;
						return onSubmit(form);
					}

					return `${formKey}.${String(field.key)}`;
				},
			},
		});
	}

	return entryPoint;
}

export async function buildContinueResponseWithErrors(menu: UssdMenu, text: string) {
	// Reads the special error key from the session and returns a continue response with the error message
	const error = await menu.session.get('__error__');

	const message = [error && error + '\n', text].filter(Boolean).join('\n');

	// Clear the error from the session
	await menu.session.set('__error__', '');

	return menu.con(message);
}

export const sessionErrors = {
	set: async (menu: UssdMenu, error: string) => {
		await menu.session.set('__error__', error);
	},
	clear: async (menu: UssdMenu) => {
		await menu.session.set('__error__', '');
	},
};

// Adds error handling to the run function of a state
export function buildRunHandler(fn: () => Promise<void> | void) {
	return (async (state: { name: string }) => {
		try {
			return await fn();
		} catch (error) {
			console.error(`Error in run handler for state ${state.name}:`, error);
			throw error;
		}
	}) as unknown as UssdStateOptions['run'];
}
