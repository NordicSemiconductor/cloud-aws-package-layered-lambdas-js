import { App } from 'aws-cdk-lib'
import { LambdaSourceCodeStorageStack } from './LambdaSourceCodeStorageStack'

/**
 * In order to deploy lambda functions written in TypeScript we need to publish
 * the compiled source code to an S3 bucket.
 * This app provides the bucket and run before the main app.
 */
export class LambdaSourceCodeStorageApp extends App {
	public constructor({ stackName }: { stackName: string }) {
		super()

		new LambdaSourceCodeStorageStack(this, stackName)
	}
}
