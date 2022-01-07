import * as CloudFormation from 'aws-cdk-lib'
import * as IAM from 'aws-cdk-lib/aws-iam'
import * as Lambda from 'aws-cdk-lib/aws-lambda'
import * as CloudWatchLogs from 'aws-cdk-lib/aws-logs'
import * as S3 from 'aws-cdk-lib/aws-s3'
import { LayeredLambdas } from '../src'

export type TestStackLambdas = {
	uuid: string
}

export class TestStack extends CloudFormation.Stack {
	public constructor(
		parent: CloudFormation.App,
		id: string,
		{
			sourceCodeBucketName,
			baseLayerZipFileName,
			lambdas,
		}: {
			sourceCodeBucketName: string
			baseLayerZipFileName: string
			lambdas: LayeredLambdas<TestStackLambdas>
		},
	) {
		super(parent, id)

		const sourceCodeBucket = S3.Bucket.fromBucketAttributes(
			this,
			'SourceCodeBucket',
			{
				bucketName: sourceCodeBucketName,
			},
		)

		const NodeJS14Runtime = new Lambda.Runtime(
			'nodejs14.x',
			Lambda.RuntimeFamily.NODEJS,
			{
				supportsInlineCode: false,
			},
		)

		const baseLayer = new Lambda.LayerVersion(this, `${id}-layer`, {
			code: Lambda.Code.fromBucket(sourceCodeBucket, baseLayerZipFileName),
			// compatibleRuntimes: [Lambda.Runtime.NODEJS_14_X], // FIXME: use once CDK has support. See https://github.com/aws/aws-cdk/pull/12861
			compatibleRuntimes: [NodeJS14Runtime],
		})

		const uuidLambda = new Lambda.Function(this, 'uuidLambda', {
			code: Lambda.Code.fromBucket(
				sourceCodeBucket,
				lambdas.lambdaZipFileNames.uuid,
			),
			layers: [baseLayer],
			description: 'Returns a v4 UUID',
			handler: 'index.handler',
			// runtime: Lambda.Runtime.NODEJS_14_X, // FIXME: use once CDK has support. See https://github.com/aws/aws-cdk/pull/12861
			runtime: NodeJS14Runtime,
			timeout: CloudFormation.Duration.seconds(15),
			initialPolicy: [
				new IAM.PolicyStatement({
					resources: ['*'],
					actions: [
						'logs:CreateLogGroup',
						'logs:CreateLogStream',
						'logs:PutLogEvents',
					],
				}),
			],
		})

		new CloudFormation.CfnOutput(this, 'uuidLambdaName', {
			value: uuidLambda.functionName,
			exportName: `${this.stackName}:uuidLambdaName`,
		})

		new CloudWatchLogs.LogGroup(this, 'uuidLambdaLogGroup', {
			removalPolicy: CloudFormation.RemovalPolicy.DESTROY,
			logGroupName: `/aws/lambda/${uuidLambda.functionName}`,
			retention: CloudWatchLogs.RetentionDays.ONE_DAY,
		})
	}
}
