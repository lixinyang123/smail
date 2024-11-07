/**
 * By default, Remix will handle generating the HTTP Response for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.server
 */

import type { AppLoadContext, EntryContext } from "@remix-run/cloudflare"
import { RemixServer } from "@remix-run/react"
import { isbot } from "isbot"
import { renderToReadableStream } from "react-dom/server"
import { d1Wrapper } from "~/.server/db"
import { sessionWrapper } from "~/.server/session"

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	remixContext: EntryContext,
	loadContext: AppLoadContext
) {
	let url = new URL(request.url).pathname

	switch (true) {
		case url.startsWith('/api'):
			return handleApi(request, loadContext)
	
		default:
			return handlePage(request, responseStatusCode, responseHeaders, remixContext)
	}
}

async function handlePage(request: Request, responseStatusCode: number,
	responseHeaders: Headers, remixContext: EntryContext) {
	const body = await renderToReadableStream(
		<RemixServer context={remixContext} url={request.url} />,
		{
			signal: request.signal,
			onError(error: unknown) {
				// Log streaming rendering errors from inside the shell
				console.error(error)
				responseStatusCode = 500
			}
		}
	)

	if (isbot(request.headers.get("user-agent") || "")) {
		await body.allReady
	}

	responseHeaders.set("Content-Type", "text/html")

	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode
	})
}

async function handleApi(request: Request, context: AppLoadContext) {
	const db = d1Wrapper(context.cloudflare.env.DB)
	const { getSession } = sessionWrapper(context.cloudflare.env)

	const session = await getSession(request.headers.get("Cookie"))

	let emails = await db.query.emails.findMany({
		columns: {
			id: true,
			subject: true,
			createdAt: true
		},
		where: (emails, { eq }) => eq(emails.messageTo, session.data.email),
		orderBy(fields, operators) {
			return [operators.desc(fields.createdAt)]
		}
	})

	return new Response(JSON.stringify(emails))
}