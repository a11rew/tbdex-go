import UssdMenu from 'ussd-builder';

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

		console.log('registering', `${formKey}.${String(field.key)}`);

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
