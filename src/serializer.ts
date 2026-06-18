import type { Rule } from '@triggerix/core'
import type { War3Registry } from './registry'
import type { ItemState, SlotValueEntry, War3EditorState } from './types'

/**
 * 递归解析单个 slot 值
 */
export function resolveSlotValue(entry: SlotValueEntry, registry: War3Registry): unknown {
  if (!entry.tool)
    return undefined

  const toolDef = registry.getTool(entry.tool)
  if (!toolDef)
    return undefined

  if (toolDef.kind === 'leaf') {
    return toolDef.resolve(entry.value)
  }

  // composite: 递归解析子槽位
  const resolvedSubSlots: Record<string, unknown> = {}
  if (entry.subSlots) {
    for (const [key, subEntry] of Object.entries(entry.subSlots)) {
      resolvedSubSlots[key] = resolveSlotValue(subEntry, registry)
    }
  }
  return toolDef.resolve(resolvedSubSlots)
}

/**
 * 解析 ItemState 的所有 slot 值为 params 对象
 */
function resolveItemParams(
  slotValues: Record<string, SlotValueEntry>,
  registry: War3Registry
): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {}
  let hasParams = false

  for (const [key, entry] of Object.entries(slotValues)) {
    const resolved = resolveSlotValue(entry, registry)
    if (resolved !== undefined) {
      params[key] = resolved
      hasParams = true
    }
  }

  return hasParams ? params : undefined
}

/**
 * 序列化 ItemState 数组为 Rule JSON 的 action/condition 列表
 */
function serializeItems(
  items: ItemState[],
  registry: War3Registry
): Array<{ type: string, params?: Record<string, unknown> }> {
  return items.map((item) => {
    const params = resolveItemParams(item.slotValues, registry)
    return {
      type: item.id,
      ...(params ? { params } : {})
    }
  })
}

function generateRuleId(): string {
  // 优先使用 crypto.randomUUID（浏览器/Node 18+）
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID()
  }
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 将编辑器状态序列化为标准 Rule JSON
 *
 * 输出结构（与 @triggerix/core 兼容）：
 *   {
 *     id, event: { type, params? }, conditions?: { type:'and', conditions:[...] },
 *     actions: [{ type, params? }]
 *   }
 *
 * 注意：实际 core 中 Event 字段为 source/payload，此处按编辑器约定使用 params 透传，
 * 由 runtime 层负责映射，因此输出统一使用宽松对象后再断言为 Rule。
 */
export function toRule(
  state: War3EditorState,
  registry: War3Registry,
  ruleId?: string
): Rule {
  const eventParams = state.event
    ? resolveItemParams(state.event.slotValues, registry)
    : undefined

  const rule: Record<string, unknown> = {
    id: ruleId ?? generateRuleId(),
    event: {
      type: state.event?.id ?? '',
      ...(eventParams ? { params: eventParams } : {})
    },
    actions: serializeItems(state.actions, registry)
  }

  if (state.conditions.length > 0) {
    rule.conditions = {
      type: 'and',
      conditions: serializeItems(state.conditions, registry)
    }
  }

  return rule as unknown as Rule
}
