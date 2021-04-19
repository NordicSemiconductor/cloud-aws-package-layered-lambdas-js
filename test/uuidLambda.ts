import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { id } from './lib.js'

export const handler = async (
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
	console.log(JSON.stringify(event))
	return {
		body: id(),
		statusCode: 200,
	}
}
