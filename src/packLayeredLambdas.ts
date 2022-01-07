import { packLambda } from './packLambda.js'
import { ConsoleProgressReporter, ProgressReporter } from './reporter.js'

export type LayeredLambdas<A extends { [key: string]: string }> = {
	id: string
	lambdaZipFileNames: A
}

export const packLayeredLambdas = async <
	A extends { [key: string]: string },
>(args: {
	id: string
	srcDir: string
	outDir: string
	Bucket: string
	lambdas: A
	ignoreFolders?: string[]
	reporter?: ProgressReporter
}): Promise<LayeredLambdas<A>> => {
	const r = args.reporter ?? ConsoleProgressReporter(args.id)
	const packs = await Promise.all(
		Object.keys(args.lambdas).map(async (lambda) =>
			packLambda({
				...args,
				name: lambda,
				src: args.lambdas[lambda],
				reporter: r,
			}),
		),
	)

	return {
		id: args.id,
		lambdaZipFileNames: packs.reduce(
			(zipFileNames, { name, zipFileName }) => ({
				...zipFileNames,
				[name]: zipFileName,
			}),
			{} as A,
		),
	}
}
