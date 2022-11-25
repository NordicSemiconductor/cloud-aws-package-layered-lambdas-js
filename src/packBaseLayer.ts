import { spawn } from 'child_process'
import * as fs from 'fs'
import * as glob from 'glob'
import * as path from 'path'
import { dirSync } from 'tmp'
import * as yazl from 'yazl'
import { checkSumOfFiles, checkSumOfStrings } from './checkSum'
import { existsOnS3 } from './existsOnS3'
import { publishToS3 } from './publishToS3'
import { ConsoleProgressReporter, ProgressReporter } from './reporter'

/**
 * Packs a base layer for use with the lambdas with all the dependencies and uploads it to S3
 */
export const packBaseLayer = async ({
	srcDir,
	outDir,
	Bucket,
	reporter,
	layerName,
	lockFileName,
	installCommand,
}: {
	srcDir: string
	outDir: string
	Bucket: string
	reporter?: ProgressReporter
	layerName?: string
	/**
	 * The name to the lockfile, defaults to "package-lock.json"
	 */
	lockFileName?: string
	/**
	 * The command (and optionally arguments) used to install the dependencies.
	 */
	installCommand?: string[]
}): Promise<string> => {
	const name = layerName ?? 'base-layer'
	const r = reporter ?? ConsoleProgressReporter('Base Layer')
	const progress = r.progress(name)
	const success = r.success(name)
	const failure = r.failure(name)
	const sizeInBytes = r.sizeInBytes(name)
	const npmicmd = installCommand ?? [
		'npm',
		'ci',
		'--ignore-scripts',
		'--omit=dev',
		'--no-audit',
	]

	const packageJson = path.resolve(srcDir, 'package.json')
	const actualLockFileName = lockFileName ?? 'package-lock.json'
	try {
		fs.statSync(packageJson)
	} catch {
		throw new Error(`package.json not found in ${packageJson}`)
	}
	const lockFile = path.resolve(srcDir, actualLockFileName)
	try {
		fs.statSync(lockFile)
	} catch {
		throw new Error(`Lockfile not found in ${lockFile}`)
	}
	const hash = checkSumOfStrings([
		(await checkSumOfFiles([packageJson, actualLockFileName])).checksum,
		npmicmd.join(' '),
	])
	const zipFilenameWithHash = `${layerName ?? 'base-layer'}-${hash}.zip`
	const localPath = path.resolve(outDir, zipFilenameWithHash)

	// Check if it already has been built and published
	progress('Checking S3 cache')
	let fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	if (fileSize) {
		success('Done')
		sizeInBytes(fileSize)
		return zipFilenameWithHash
	}

	// Check if it already has been built locally
	try {
		progress('Checking local file')
		const { size } = fs.statSync(localPath)
		sizeInBytes(size)
		// File exists
		progress('Publishing to S3', `-> ${Bucket}`)
		await publishToS3(Bucket, zipFilenameWithHash, localPath)
		await existsOnS3(Bucket, zipFilenameWithHash, outDir)
		success('Done')
		return zipFilenameWithHash
	} catch {
		// Pass
	}

	// Check if file exists on S3
	progress('Checking S3 cache')
	fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	if (fileSize) {
		success('Done')
		sizeInBytes(fileSize)
		return zipFilenameWithHash
	}

	progress('Packing base layer')

	const tempDir = dirSync({ unsafeCleanup: false }).name
	const installDir = `${tempDir}${path.sep}nodejs`
	const lockFileTarget = `${installDir}${path.sep}${actualLockFileName}`
	fs.mkdirSync(installDir)
	fs.copyFileSync(packageJson, `${installDir}${path.sep}package.json`)

	progress('Copying the lockfile')
	fs.copyFileSync(lockFile, lockFileTarget)

	await new Promise<void>((resolve, reject) => {
		const [cmd, ...args] = npmicmd
		progress(`Installing dependencies: ${[cmd, ...args].join(' ')}`)
		const p = spawn(cmd, args, {
			cwd: installDir,
		})
		p.on('close', (code) => {
			if (code !== 0) {
				const msg = `${cmd} ${args.join(
					' ',
				)} in ${installDir} exited with code ${code}.`
				failure(msg)
				return reject(new Error(msg))
			}
			success('Dependencies installed')
			return resolve()
		})
		p.stdout.on('data', (data) => {
			progress('Installing dependencies:', data.toString())
		})
		p.stderr.on('data', (data) => {
			progress('Installing dependencies:', data.toString())
		})
	})

	await new Promise<void>((resolve) => {
		progress('Creating archive')
		const zipfile = new yazl.ZipFile()
		const files = glob.sync(`${tempDir}${path.sep}**${path.sep}*`)
		files.forEach((file) => {
			if (fs.statSync(file).isFile()) {
				zipfile.addFile(file, file.replace(`${tempDir}${path.sep}`, ''))
			}
		})
		zipfile.outputStream
			.pipe(fs.createWriteStream(localPath))
			.on('close', () => {
				success(
					'Layer packed',
					`${Math.round(fs.statSync(localPath).size / 1024)}KB`,
				)
				resolve()
			})
		zipfile.end()
	})

	progress('Publishing to S3', `-> ${Bucket}`)
	await publishToS3(Bucket, zipFilenameWithHash, localPath)
	fileSize = await existsOnS3(Bucket, zipFilenameWithHash, outDir)
	sizeInBytes(fileSize)
	success('All done')

	return zipFilenameWithHash
}
