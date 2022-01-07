import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import yazl from 'yazl'
import { checkSumOfStrings } from './checkSum.js'
import { existsOnS3 } from './existsOnS3.js'
import { hashDependencies } from './hashDependencies.js'
import { publishToS3 } from './publishToS3.js'
import { ProgressReporter } from './reporter.js'

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
}): Promise<{
	name: string
	zipFileName: string
	dependencies: {
		files: string[]
		checksum: string
		hashes: { [key: string]: string }
	}
}> => {
	const { outDir, Bucket, name, src, reporter, srcDir } = args
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
	const { checksum: depsChecksum, hashes } = deps
	const hash = checkSumOfStrings([depsChecksum])
	const zipFilenameWithHash = `${name}-${hash}-esm.zip`
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
	await new Promise<void>((resolve, reject) => {
		progress?.('Creating archive')
		const zipfile = new yazl.ZipFile()
		// Add script
		console.log(src)
		zipfile.addFile(src, src.replace(srcDir, '').replace(/^\//, ''))
		// Add all dependencies (includes the entry script itself)
		for (const dep of deps.files.filter((f) => f !== src)) {
			console.log(dep)
			zipfile.addFile(dep, dep.replace(srcDir, '').replace(/^\//, ''))
		}
		zipfile.addBuffer(
			Buffer.from(
				Object.entries(hashes)
					.map(
						([file, hash]) =>
							`${hash}\t${file.replace(srcDir, '').replace(/^\//, '')}`,
					)
					.join('\n'),
			),
			'hashes.tsv',
		)
		zipfile.addBuffer(
			Buffer.from(
				JSON.stringify(
					{
						name,
						type: 'module',
					},
					null,
					2,
				),
			),
			'package.json',
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
