import {
  SYSTEM_ROLES,
  fullName,
  type ChatMessageDto,
  type ChatMessageInput,
  type ChatMessagesPage,
  type ChatPerson,
  type ConversationListItem,
  type StartConversationInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { notify } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Team chat: one-to-one chats and named groups. People can chat with anyone
 * who works at one of their restaurants (and the Super Admins). The apps poll
 * for new messages; each person gets at most one unread notification per chat.
 */

const PAGE = 30
const person = { select: { id: true, firstName: true, lastName: true } } as const

/** Everyone this person may chat with (active, same restaurant, or a Super Admin). */
function reachableWhere(auth: AuthContext): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    organizationId: auth.organizationId,
    status: 'ACTIVE',
    archivedAt: null,
    id: { not: auth.userId },
  }
  if (auth.isSuperAdmin) return base
  return {
    ...base,
    OR: [
      { userRestaurants: { some: { restaurantId: { in: [...auth.restaurantIds] } } } },
      { userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
    ],
  }
}

export async function chatPeople(auth: AuthContext, q = ''): Promise<ChatPerson[]> {
  const term = q.trim()
  const rows = await prisma.user.findMany({
    where: {
      ...reachableWhere(auth),
      ...(term
        ? {
            AND: [
              {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    },
    select: { ...person.select, userRoles: { select: { role: { select: { name: true } } }, take: 1 } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 100,
  })
  return rows.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.userRoles[0]?.role.name ?? null,
  }))
}

async function membership(auth: AuthContext, conversationId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    include: { conversation: { select: { organizationId: true, type: true, name: true } } },
  })
  if (!m || m.leftAt || m.conversation.organizationId !== auth.organizationId)
    throw new NotFoundError('Chat')
  return m
}

export async function listConversations(auth: AuthContext): Promise<ConversationListItem[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      organizationId: auth.organizationId,
      members: { some: { userId: auth.userId, leftAt: null } },
    },
    include: {
      members: {
        where: { leftAt: null },
        select: {
          userId: true,
          lastReadAt: true,
          user: { select: { ...person.select, userRoles: { select: { role: { select: { name: true } } }, take: 1 } } },
        },
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { author: person },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })
  const unread = await Promise.all(
    rows.map((c) => {
      const me = c.members.find((m) => m.userId === auth.userId)
      return prisma.chatMessage.count({
        where: {
          conversationId: c.id,
          deletedAt: null,
          authorId: { not: auth.userId },
          createdAt: { gt: me?.lastReadAt ?? new Date(0) },
        },
      })
    }),
  )
  return rows.map((c, i) => {
    const others = c.members.filter((m) => m.userId !== auth.userId)
    const last = c.messages[0]
    return {
      id: c.id,
      type: c.type,
      title:
        c.type === 'GROUP'
          ? (c.name ?? '')
          : others[0]
            ? fullName(others[0].user)
            : '—',
      members: c.members.map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.user.userRoles[0]?.role.name ?? null,
      })),
      lastMessage: last
        ? { body: last.body.slice(0, 140), authorName: fullName(last.author), createdAt: last.createdAt.toISOString() }
        : null,
      unread: unread[i]!,
      lastMessageAt: c.lastMessageAt.toISOString(),
    }
  })
}

export async function unreadTotal(auth: AuthContext): Promise<number> {
  const mine = await prisma.conversationMember.findMany({
    where: { userId: auth.userId, leftAt: null, conversation: { organizationId: auth.organizationId } },
    select: { conversationId: true, lastReadAt: true },
  })
  if (mine.length === 0) return 0
  return prisma.chatMessage.count({
    where: {
      deletedAt: null,
      authorId: { not: auth.userId },
      OR: mine.map((m) => ({ conversationId: m.conversationId, createdAt: { gt: m.lastReadAt } })),
    },
  })
}

async function assertReachable(auth: AuthContext, userIds: string[]) {
  const found = await prisma.user.count({ where: { ...reachableWhere(auth), id: { in: userIds } } })
  if (found !== userIds.length) throw new ValidationError({ userIds: ['validation.invalidValue'] })
}

/** Opens (or reuses) a one-to-one chat, or creates a group. Returns its id. */
export async function startConversation(
  auth: AuthContext,
  input: StartConversationInput,
): Promise<{ id: string }> {
  const others = [...new Set(input.userIds)].filter((id) => id !== auth.userId)
  if (others.length === 0) throw new ValidationError({ userIds: ['validation.required'] })
  await assertReachable(auth, others)
  if (others.length === 1 && !input.name) {
    const directKey = [auth.userId, others[0]!].sort().join(':')
    const existing = await prisma.conversation.findUnique({ where: { directKey } })
    if (existing) {
      // Re-open it for both if either had left.
      await prisma.conversationMember.updateMany({
        where: { conversationId: existing.id },
        data: { leftAt: null },
      })
      return { id: existing.id }
    }
    const c = await prisma.conversation.create({
      data: {
        organizationId: auth.organizationId,
        type: 'DIRECT',
        directKey,
        createdById: auth.userId,
        members: { create: [{ userId: auth.userId }, { userId: others[0]! }] },
      },
    })
    return { id: c.id }
  }
  if (input.name.length < 2) throw new ValidationError({ name: ['validation.required'] })
  const c = await prisma.conversation.create({
    data: {
      organizationId: auth.organizationId,
      type: 'GROUP',
      name: input.name,
      createdById: auth.userId,
      members: { create: [auth.userId, ...others].map((userId) => ({ userId })) },
    },
  })
  return { id: c.id }
}

function toMessage(
  auth: AuthContext,
  m: Prisma.ChatMessageGetPayload<{ include: { author: typeof person } }>,
  workOrders: Map<string, { id: string; code: string; title: string }>,
): ChatMessageDto {
  return {
    id: m.id,
    body: m.deletedAt ? '' : m.body,
    author: m.author,
    workOrder: m.workOrderId && !m.deletedAt ? (workOrders.get(m.workOrderId) ?? null) : null,
    createdAt: m.createdAt.toISOString(),
    mine: m.authorId === auth.userId,
    deleted: !!m.deletedAt,
  }
}

async function workOrderCards(auth: AuthContext, ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const rows = await prisma.workOrder.findMany({
    where: { id: { in: unique }, organizationId: auth.organizationId },
    select: { id: true, code: true, title: true },
  })
  return new Map(rows.map((w) => [w.id, w]))
}

export async function listMessages(
  auth: AuthContext,
  conversationId: string,
  q: { before?: string; after?: string },
): Promise<ChatMessagesPage> {
  await membership(auth, conversationId)
  const cursorId = q.before ?? q.after
  const cursor = cursorId
    ? await prisma.chatMessage.findFirst({
        where: { id: cursorId, conversationId },
        select: { createdAt: true },
      })
    : null
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      ...(cursor
        ? { createdAt: q.before ? { lt: cursor.createdAt } : { gt: cursor.createdAt } }
        : {}),
    },
    include: { author: person },
    orderBy: { createdAt: q.after ? 'asc' : 'desc' },
    take: PAGE + 1,
  })
  const hasMore = rows.length > PAGE
  const page = rows.slice(0, PAGE)
  const ordered = q.after ? page : page.reverse()
  const cards = await workOrderCards(
    auth,
    ordered.map((m) => m.workOrderId).filter((x): x is string => !!x),
  )
  return { messages: ordered.map((m) => toMessage(auth, m, cards)), hasMore: q.after ? false : hasMore }
}

export async function sendMessage(
  auth: AuthContext,
  conversationId: string,
  input: ChatMessageInput,
): Promise<ChatMessageDto> {
  const m = await membership(auth, conversationId)
  let workOrderId: string | null = null
  if (input.workOrderId) {
    const wo = await prisma.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: auth.organizationId },
      select: { id: true },
    })
    if (!wo) throw new ValidationError({ workOrderId: ['validation.invalidValue'] })
    workOrderId = wo.id
  }
  const now = new Date()
  const msg = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: { conversationId, authorId: auth.userId, body: input.body, workOrderId, createdAt: now },
      include: { author: person },
    })
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
    await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: auth.userId } },
      data: { lastReadAt: now },
    })
    return created
  })

  // One unread notification per chat per person: skip people who already have one.
  const others = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null, userId: { not: auth.userId } },
    select: { userId: true },
  })
  const pending = await prisma.notification.findMany({
    where: {
      recipientId: { in: others.map((o) => o.userId) },
      entityType: 'CONVERSATION',
      entityId: conversationId,
      readAt: null,
    },
    select: { recipientId: true },
  })
  const skip = new Set(pending.map((p) => p.recipientId))
  const author = fullName(auth.user)
  await notify(
    others.map((o) => o.userId).filter((id) => !skip.has(id)),
    {
      organizationId: auth.organizationId,
      type: 'CHAT_MESSAGE',
      title: m.conversation.type === 'GROUP' ? `${m.conversation.name} · ${author}` : author,
      body: input.body.slice(0, 200),
      entityType: 'CONVERSATION',
      entityId: conversationId,
      actionUrl: `/chat/${conversationId}`,
    },
  )
  const cards = await workOrderCards(auth, workOrderId ? [workOrderId] : [])
  return toMessage(auth, msg, cards)
}

/** Marks the chat read (and its notification). */
export async function markRead(auth: AuthContext, conversationId: string) {
  await membership(auth, conversationId)
  const now = new Date()
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    data: { lastReadAt: now },
  })
  await prisma.notification.updateMany({
    where: { recipientId: auth.userId, entityType: 'CONVERSATION', entityId: conversationId, readAt: null },
    data: { readAt: now },
  })
}

export async function addMembers(auth: AuthContext, conversationId: string, userIds: string[]) {
  const m = await membership(auth, conversationId)
  if (m.conversation.type !== 'GROUP') throw new ForbiddenError()
  const ids = [...new Set(userIds)].filter((id) => id !== auth.userId)
  await assertReachable(auth, ids)
  for (const userId of ids)
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId },
      update: { leftAt: null },
    })
}

export async function leaveConversation(auth: AuthContext, conversationId: string) {
  const m = await membership(auth, conversationId)
  if (m.conversation.type !== 'GROUP') throw new ForbiddenError()
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    data: { leftAt: new Date() },
  })
}

/** Authors can remove their own message ("message deleted" stays in place). */
export async function deleteMessage(auth: AuthContext, conversationId: string, messageId: string) {
  await membership(auth, conversationId)
  const done = await prisma.chatMessage.updateMany({
    where: { id: messageId, conversationId, authorId: auth.userId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  if (!done.count) throw new NotFoundError('Message')
}
