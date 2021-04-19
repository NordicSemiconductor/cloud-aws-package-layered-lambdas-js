import { LambdaSourceCodeStorageApp } from './LambdaSourceCodeStorageApp.js'
import { LambdaSourceCodeStorageStack } from './LambdaSourceCodeStorageStack.js'

const stackName = process.env.STACK_NAME

if (stackName === undefined) {
	console.error(`STACK_NAME not set!`)
	process.exit(1)
}

new LambdaSourceCodeStorageApp({
	stackName: LambdaSourceCodeStorageStack.stackName({ stackName }),
}).synth()
