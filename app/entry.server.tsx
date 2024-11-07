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
import randomName from "@scaleway/random-name"
import { customAlphabet } from "nanoid"
import { formatDistanceToNow } from "date-fns";

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	remixContext: EntryContext,
	loadContext: AppLoadContext
) {
	if (new URL(request.url).pathname.startsWith('/api')) {
		return handleApi(request, loadContext)
	}

	return handlePage(request, responseStatusCode, responseHeaders, remixContext)
}

/**
 * SSR
 */

async function handlePage(request: Request, responseStatusCode: number,
	responseHeaders: Headers, remixContext: EntryContext) {
	const body = await renderToReadableStream(
		<RemixServer context={remixContext} url={request.url} />,
		{
			signal: request.signal,
			onError(error: unknown) {
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

/**
 * Web API
 */

async function handleApi(request: Request, context: AppLoadContext) {
	switch (request.method) {
		case 'GET': return mapGet(request, context)
		case 'POST': return mapPost(request, context)
		case 'DELETE': return mapDelete(request, context)
		default: return new Response("not found", { status: 404 })
	}
}

async function mapGet(request: Request, context: AppLoadContext) {
	const { getSession } = sessionWrapper(context.cloudflare.env)
	const session = await getSession(request.headers.get("Cookie"))
	const db = d1Wrapper(context.cloudflare.env.DB)

	const emails = await db.query.emails.findMany({
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

	const newEails = emails.map((email) => ({
		...email,
		createdAt: formatDistanceToNow(email.createdAt, {
			addSuffix: true
		})
	}))

	return new Response(JSON.stringify({
		emails: newEails,
		turnstileSiteKey: context.cloudflare.env.TURNSTILE_SITE_KEY,
	}))
}

async function mapPost(request: Request, context: AppLoadContext) {
	const { getSession, commitSession } = sessionWrapper(context.cloudflare.env)
	const session = await getSession(request.headers.get("Cookie"))

	if (session.data.email) {
		return new Response('bad request', { status: 500 })
	}

	const name = `${randomName("", ".")}.${customAlphabet("0123456789", 4)()}`
	const email = `${name}@${context.cloudflare.env.DOMAIN || "conchbrain.club"}`

	session.set("email", email)
	return new Response(email, {
		headers: {
			"Set-Cookie": await commitSession(session),
		}
	})
}

async function mapDelete(request: Request, context: AppLoadContext) {
	const { getSession, commitSession } = sessionWrapper(context.cloudflare.env)
	const session = await getSession(request.headers.get("Cookie"))

	if (!session.data.email) {
		return new Response('bad request', { status: 500 })
	}

	session.unset("email");
	return new Response(session.data.email, {
		headers: {
			"Set-Cookie": await commitSession(session)
		}
	})
}
