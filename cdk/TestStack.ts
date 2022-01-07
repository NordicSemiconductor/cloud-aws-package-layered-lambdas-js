import * as CloudFormation from 'aws-cdk-lib'
import * as IAM from 'aws-cdk-lib/aws-iam'
import * as Lambda from 'aws-cdk-lib/aws-lambda'
import * as CloudWatchLogs from 'aws-cdk-lib/aws-logs'
import * as S3 from 'aws-cdk-lib/aws-s3'
import { LayeredLambdas } from '../src/index.js'

export type TestStackLambdas = {
	uuidLambda: string
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

		const uuid = new Lambda.Function(this, 'uuid', {
			code: Lambda.Code.fromBucket(
				sourceCodeBucket,
				lambdas.lambdaZipFileNames.uuidLambda,
			),
			layers: [baseLayer],
			description: 'Returns a v4 UUID',
			handler: 'lambda/uuidLambda.handler',
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
			value: uuid.functionName,
			exportName: `${this.stackName}:uuidLambdaName`,
		})

		new CloudWatchLogs.LogGroup(this, 'uuidLogGroup', {
			removalPolicy: CloudFormation.RemovalPolicy.DESTROY,
			logGroupName: `/aws/lambda/${uuid.functionName}`,
			retention: CloudWatchLogs.RetentionDays.ONE_DAY,
		})
	}
}
