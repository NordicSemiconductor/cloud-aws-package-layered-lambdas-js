import { prepareResources } from './prepareResources'
import { TestApp } from './TestApp'

const stackName = process.env.STACK_NAME

if (stackName === undefined) {
	console.error(`STACK_NAME not set!`)
	process.exit(1)
}

prepareResources({
	stackName,
	rootDir: process.cwd(),
})
	.then((args) =>
		new TestApp({
			stackName,
			...args,
		}).synth(),
	)
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
