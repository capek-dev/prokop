import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { AskQuestion } from '@/components/chat/AskQuestion';
import type { PendingAskRequest } from '@/stores/askStore';

function requestWith(ask: PermissionAsk): PendingAskRequest {
  return { toolCallId: 'call-1', sessionId: 'sess', toolName: 'shell', ask };
}

/** Legacy ask: risk authored by the builder, no concern fields. */
function legacyRequest(risk?: PermissionRiskLevel): PendingAskRequest {
  return requestWith({
    type: 'permission',
    question: `Run command "npm run ${risk ?? 'unknown'}" (within workspace).`,
    ...(risk != null ? { risk } : {}),
  } as PermissionAsk);
}

/** Classified ask (permissions v2): concerns on the wire; the pinned legacy
 *  risk deliberately disagrees to prove classification takes precedence. */
function classifiedRequest(
  concerns: readonly string[],
  catastrophic = false,
): PendingAskRequest {
  return requestWith({
    type: 'permission',
    question: 'Run command "npm run build" (within workspace).',
    risk: 'medium',
    concerns,
    catastrophic,
  } as PermissionAsk);
}

function cardClasses(request: PendingAskRequest): string {
  const { container } = render(<AskQuestion request={request} onRespond={() => {}} />);
  return (container.firstChild as HTMLElement).className;
}

afterEach(cleanup);

describe('permission card severity chrome (classified asks)', () => {
  test('catastrophic findings get the strongest red despite a pinned medium risk', () => {
    const classes = cardClasses(classifiedRequest(['destructive'], true));
    expect(classes).toContain('bg-destructive/10');
    expect(classes).toContain('border-destructive/50');
  });

  test('sensitive or destructive concerns read high severity red', () => {
    for (const concerns of [['sensitive'], ['destructive'], ['destructive', 'escape']]) {
      const classes = cardClasses(classifiedRequest(concerns));
      expect(classes).toContain('bg-destructive/5');
      expect(classes).toContain('border-destructive/30');
    }
  });

  test('escape-only reads amber, matching the server riskOfConcerns mapping', () => {
    const classes = cardClasses(classifiedRequest(['escape']));
    expect(classes).toContain('bg-warning/5');
  });

  test('clean or opaque-only findings read low severity', () => {
    for (const concerns of [[], ['opaque']]) {
      const classes = cardClasses(classifiedRequest(concerns));
      expect(classes).toContain('bg-success/5');
    }
  });
});

describe('permission card severity chrome (legacy asks)', () => {
  test('each risk level gets a distinct, escalating card tint', () => {
    expect(cardClasses(legacyRequest('low'))).toContain('bg-success/5');
    expect(cardClasses(legacyRequest('medium'))).toContain('bg-warning/5');
    expect(cardClasses(legacyRequest('high'))).toContain('bg-destructive/5');
    expect(cardClasses(legacyRequest('critical'))).toContain('bg-destructive/10');
    expect(cardClasses(legacyRequest('critical'))).toContain('border-destructive/50');
  });

  test('classified-none reads neutral instead of amber', () => {
    expect(cardClasses(legacyRequest('none'))).toContain('bg-muted/40');
  });

  test('unclassified asks keep the historical amber default', () => {
    expect(cardClasses(legacyRequest(undefined))).toContain('bg-warning/5');
  });
});
