import { App } from 'aws-cdk-lib'
import { LayeredLambdas } from '../src'
import { TestStack, TestStackLambdas } from './TestStack'

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
