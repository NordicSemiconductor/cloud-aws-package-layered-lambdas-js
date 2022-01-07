import { App } from '@aws-cdk/core'
import { LayeredLambdas } from '../src/index.js'
import { TestStack, TestStackLambdas } from './TestStack.js'

export class TestApp extends App {
	public constructor(args: {
		stackName: string
		sourceCodeBucketName: string
		baseLayerZipFileName: string
		lambdas: LayeredLambdas<TestStackLambdas>
	}) {
		super()
		new TestStack(this, args.stackName, {
			...args,
		})
	}
}
