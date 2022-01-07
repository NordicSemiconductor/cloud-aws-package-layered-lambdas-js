import { CloudFormationClient } from '@aws-sdk/client-cloudformation'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { stackOutput } from '@nordicsemiconductor/cloudformation-helpers'
import { strict as assert } from 'assert'
import { TextDecoder } from 'util'

const cf = new CloudFormationClient({})
const so = stackOutput(cf)
const λ = new LambdaClient({})

so<{ uuidName: string }>(process.env.STACK_NAME ?? '')
	.then(async ({ uuidName }) =>
		λ.send(
			new InvokeCommand({
				FunctionName: uuidName,
			}),
		),
	)
	.then(({ Payload }) => {
		if (Payload === undefined) throw new Error(`No payload.`)
		const response = new TextDecoder('utf-8').decode(Payload)
		try {
			const { statusCode, body } = JSON.parse(response)
			console.debug({ statusCode, body })
			assert.equal(statusCode, 200, 'Status code should be 200')
			assert.match(
				body,
				/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
				'Body should be a v4 UUID',
			)
		} catch (err) {
			assert.fail(`Failed to parse JSON: ${response}`)
		}
	})
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
