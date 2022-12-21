import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { randomUUID } from 'node:crypto'

export const handler = async (
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
	console.log(JSON.stringify(event))
	return {
		body: randomUUID(),
		statusCode: 200,
	}
}
