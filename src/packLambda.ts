import * as chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import * as webpack from 'webpack'
import * as yazl from 'yazl'
import { existsOnS3 } from './existsOnS3'
import { hashDependencies } from './hashDependencies'
import { publishToS3 } from './publishToS3'
import { ProgressReporter } from './reporter'

/**
 * Packs the lambda and all of its inter-project dependencies using webpack and uploads it to S3
 */
export const packLambda = async (args: {
	srcDir: string
	outDir: string
	Bucket: string
	name: string
	src: string
	tsConfig: string
	reporter?: ProgressReporter
	ignoreFolders?: string[]
	webpackConfiguration?: webpack.Configuration
}): Promise<{
	name: string
	zipFileName: string
	dependencies: {
		files: string[]
		checksum: string
		hashes: { [key: string]: string }
	}
}> => {
	const {
		tsConfig,
		outDir,
		Bucket,
		name,
		src,
		reporter,
		webpackConfiguration,
	} = args
	const progress = reporter?.progress?.(name)
	const success = reporter?.success?.(name)
	const failure = reporter?.failure?.(name)
	const sizeInBytes = reporter?.sizeInBytes?.(name)

	try {
		fs.statSync(src)
	} catch (e) {
		failure?.(
			`The source file ${chalk.cyan(src)} for ${chalk.green(
				name,
			)} does not exist!`,
		)
		throw e
	}
	const deps = await hashDependencies({
		...args,
		name,
	})
	const { checksum: hash, hashes } = deps
	const jsFilenameWithHash = `${name}-${hash}.js`
	const zipFilenameWithHash = `${name}-${hash}-113ed.zip`
	const localPath = path.resolve(outDir, zipFilenameWithHash)

	// Check if it already has been built and published
	progress?.('Checking if lambda exists on S3')
	let fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	if (fileSize) {
		success?.('OK')
		sizeInBytes?.(fileSize)
		return {
			name,
			zipFileName: zipFilenameWithHash,
			dependencies: deps,
		}
	}

	// Check if it already has been built locally
	try {
		const { size } = fs.statSync(localPath)
		success?.('OK')
		sizeInBytes?.(size)
		// File exists
		progress?.('Publishing to S3', `-> ${Bucket}`)
		await publishToS3(Bucket, zipFilenameWithHash, localPath)
		await existsOnS3(Bucket, zipFilenameWithHash, outDir)
		return {
			name,
			zipFileName: zipFilenameWithHash,
			dependencies: deps,
		}
	} catch {
		// Pass
	}

	// Check if file exists on S3
	progress?.('Checking if lambda exists on S3')
	fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	if (fileSize) {
		success?.('OK')
		sizeInBytes?.(fileSize)
		return {
			name,
			zipFileName: zipFilenameWithHash,
			dependencies: deps,
		}
	}

	progress?.('Packing')
	await new Promise<void>((resolve, reject) =>
		webpack(
			{
				entry: [src],
				mode: 'production',
				target: 'node',
				externals: [
					// ignore all modules in node_modules folder
					// Every non-relative module is external
					// abc -> require("abc")
					/^[a-z\-0-9]+$/,
				],
				module: {
					rules: [
						{
							test: /\.ts$/,
							loader: 'ts-loader',
							exclude: /node_modules/,
							options: {
								configFile: tsConfig,
								transpileOnly: true,
							},
						},
						...(webpackConfiguration?.module?.rules ?? []),
					],
					...webpackConfiguration?.module,
				},
				optimization: {
					removeAvailableModules: false,
					splitChunks: false,
					minimize: false,
					...webpackConfiguration?.optimization,
				},
				resolve: {
					extensions: ['.ts', '.ts', '.js'],
				},
				output: {
					path: outDir,
					libraryTarget: 'umd',
					filename: jsFilenameWithHash,
				},
				...webpackConfiguration,
			},
			async (err, stats) => {
				if (err !== null && err !== undefined) {
					failure?.('webpack failed', err?.message)
					console.error(err)
					if (stats?.hasErrors() ?? false) console.error(stats?.toString())
					return reject(err)
				}
				const f = path.resolve(outDir, jsFilenameWithHash)

				progress?.('Creating archive')
				const zipfile = new yazl.ZipFile()
				zipfile.addFile(f, 'index.js')
				zipfile.addBuffer(
					Buffer.from(JSON.stringify(hashes, null, 2)),
					'hashes.json',
				)
				zipfile.outputStream
					.pipe(fs.createWriteStream(localPath))
					.on('close', () => {
						success?.(
							'Lambda packed',
							`${Math.round(fs.statSync(localPath).size / 1024)}KB`,
						)
						resolve()
					})
				zipfile.end()
			},
		),
	)

	progress?.('Publishing to S3', `-> ${Bucket}`)
	await publishToS3(Bucket, zipFilenameWithHash, localPath)
	fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	sizeInBytes?.(fileSize)
	success?.('All done')

	return {
		zipFileName: zipFilenameWithHash,
		name,
		dependencies: deps,
	}
}
