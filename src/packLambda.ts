import chalk from 'chalk'
import path from 'path'
import fs from 'fs'
import yazl from 'yazl'
import { existsOnS3 } from './existsOnS3.js'
import { publishToS3 } from './publishToS3.js'
import { hashDependencies } from './hashDependencies.js'
import { ProgressReporter } from './reporter.js'
import { build, BuildOptions } from 'esbuild'
import { checkSumOfStrings } from './checkSum.js'

/**
 * Packs the lambda and all of its inter-project dependencies using esbuild and uploads it to S3
 */
export const packLambda = async (args: {
	srcDir: string
	outDir: string
	Bucket: string
	name: string
	src: string
	reporter?: ProgressReporter
	ignoreFolders?: string[]
	esbuildOptions?: BuildOptions
}): Promise<{
	name: string
	zipFileName: string
	dependencies: {
		files: string[]
		checksum: string
		hashes: { [key: string]: string }
	}
}> => {
	const { outDir, Bucket, name, src, reporter, esbuildOptions } = args
	const progress = reporter?.progress?.(name)
	const success = reporter?.success?.(name)
	const failure = reporter?.failure?.(name)
	const sizeInBytes = reporter?.sizeInBytes?.(name)

	const buildOpts: BuildOptions = {
		entryPoints: [src],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		plugins: [
			{
				name: 'exclude-node_modules',
				setup: (build) => {
					build.onResolve({ filter: /./ }, (args) => {
						const absolutePath = path.join(args.resolveDir, args.path)
						if (absolutePath.includes('/node_modules/')) {
							return {
								path: args.resolveDir.replace(/.+\/node_modules\//, ''),
								external: true,
							}
						}
						return undefined
					})
				},
			},
		],
		...esbuildOptions,
	}

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
	const { checksum: depsChecksum, hashes } = deps
	const hash = checkSumOfStrings([depsChecksum, JSON.stringify(buildOpts)])
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
	const f = path.resolve(outDir, jsFilenameWithHash)
	await build({
		...buildOpts,
		outfile: f,
	})

	await new Promise<void>((resolve, reject) => {
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
			.on('error', () => {
				failure?.(`Failed to create ZIP archive!`)
				reject(new Error(`Failed to create ZIP archive.`))
			})
		zipfile.end()
	})

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
