import path from 'path'
import { promises as fs } from 'fs'
import { getLambdaSourceCodeBucketName } from './getLambdaSourceCodeBucketName.js'
import { TestStackLambdas } from './TestStack.js'
import {
	LayeredLambdas,
	packLayeredLambdas,
} from '../src/packLayeredLambdas.js'
import { packBaseLayer } from '../src/packBaseLayer.js'

export const prepareResources = async ({
	stackName,
	rootDir,
}: {
	stackName: string
	rootDir: string
}): Promise<{
	sourceCodeBucketName: string
	baseLayerZipFileName: string
	lambdas: LayeredLambdas<TestStackLambdas>
}> => {
	// Prepare the output directory
	const outDir = path.resolve(rootDir, 'dist', 'lambdas')
	try {
		await fs.stat(outDir)
	} catch (_) {
		await fs.mkdir(outDir)
	}
	const sourceCodeBucketName = await getLambdaSourceCodeBucketName({
		stackName,
	})

	// Pack the baselayer, only with needed dependencies

	// - This will contain the package.json to be used for the layer
	const layerFolder = path.resolve(rootDir, 'dist', 'lambdas', 'layer')
	try {
		await fs.stat(layerFolder)
	} catch (_) {
		await fs.mkdir(layerFolder)
	}

	// - Pick relevant dependencies from the project's package.json
	//   so it they have the right version
	const { dependencies } = JSON.parse(
		await fs.readFile(path.resolve(rootDir, 'package.json'), 'utf-8'),
	)
	const lambdaDependencies = {
		uuid: dependencies['uuid'],
	}
	if (
		Object.values(lambdaDependencies).find((v) => v === undefined) !== undefined
	) {
		throw new Error(
			`Could not resolve all dependencies in "${JSON.stringify(
				lambdaDependencies,
			)}"`!,
		)
	}
	// - add them to the layers package.json
	await fs.writeFile(
		path.join(layerFolder, 'package.json'),
		JSON.stringify({
			dependencies: lambdaDependencies,
		}),
		'utf-8',
	)
	// - copy the existing lockfile to re-use
	await fs.copyFile(
		path.resolve(rootDir, 'package-lock.json'),
		path.join(layerFolder, 'package-lock.json'),
	)
	const baseLayerZipFileName = await packBaseLayer({
		srcDir: layerFolder,
		outDir,
		Bucket: sourceCodeBucketName,
	})

	// Pack the lambda
	const lambdas = await packLayeredLambdas<TestStackLambdas>({
		id: 'test-lambdas',
		srcDir: rootDir,
		outDir,
		Bucket: sourceCodeBucketName,
		lambdas: {
			uuid: path.resolve(rootDir, 'test', 'uuidLambda.ts'),
		},
		tsConfig: path.resolve(rootDir, 'tsconfig.json'),
	})

	return {
		sourceCodeBucketName,
		baseLayerZipFileName,
		lambdas,
	}
}
