import { describe, expect, it, vi } from 'vitest';
import {
  generateDek,
  generateUserKeypair,
  unlockUserKeypair,
  unwrapDek,
  wrapDek,
} from '@/lib/e2e/crypto';
import { enrollKeypair, type StoredSealed } from '@/lib/e2e/enroll-client';
import { decryptPageContent, encryptPageContent } from '@/lib/e2e/page-cipher';
import { runRekey } from '@/lib/e2e/rekey-client';

type Wrapped = { memberUserId: string; wrappedWsk: string };
type PageBundle = { pageId: string; contentEncrypted: string };

const WS = '00000000-0000-0000-0000-0000000000aa';
const PAGE1 = '00000000-0000-0000-0000-0000000000b1';
const PAGE2 = '00000000-0000-0000-0000-0000000000b2';

async function makeMember(passphrase: string) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const okFetch = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ) as unknown as typeof fetch;
  await enrollKeypair(passphrase, { fetch: okFetch, storage });
  const stored = JSON.parse(store.get('cairn.e2e.sealedKeypair') as string) as StoredSealed;
  const unlocked = await unlockUserKeypair(
    {
      publicKey: Buffer.from(stored.publicKey, 'base64'),
      encryptedPrivateKey: Buffer.from(stored.encryptedPrivateKey, 'base64'),
      kdfSalt: Buffer.from(stored.kdfSalt, 'base64'),
      kdfIters: stored.kdfIters,
    },
    passphrase,
  );
  return { stored, unlocked };
}

/**
 * Build a fetch stub serving the rekey endpoints from an in-memory fixture and
 * capturing the final /rekey POST body.
 */
function makeFetch(opts: {
  ownerWrappedWsk: string;
  keyVersion: number;
  roster: Array<{ memberUserId: string; publicKey: string }>;
  encryptedPages: PageBundle[];
  capture: (body: {
    wrapped: Wrapped[];
    pageBundles: PageBundle[];
    removedMemberId: string | null;
  }) => void;
}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/e2e/my-wsk')) {
      return new Response(
        JSON.stringify({ wrappedWsk: opts.ownerWrappedWsk, keyVersion: opts.keyVersion }),
        { status: 200 },
      );
    }
    if (u.includes('/keypair-roster')) {
      return new Response(JSON.stringify(opts.roster), { status: 200 });
    }
    if (u.includes('/e2e/encrypted-pages')) {
      return new Response(JSON.stringify(opts.encryptedPages), { status: 200 });
    }
    if (u.includes('/e2e/rekey')) {
      const body = JSON.parse(String(init?.body)) as {
        wrapped: Wrapped[];
        pageBundles: PageBundle[];
        removedMemberId: string | null;
      };
      opts.capture(body);
      return new Response(JSON.stringify({ ok: true, keyVersion: opts.keyVersion + 1 }), {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('runRekey crypto round-trip (#168)', () => {
  it('mints a fresh WSK, re-wraps for remaining members, and re-encrypts pages (forward secrecy)', async () => {
    const ownerId = '11111111-1111-1111-1111-111111111111';
    const m1Id = '22222222-2222-2222-2222-222222222222';
    const m2Id = '33333333-3333-3333-3333-333333333333';

    const owner = await makeMember('owner-pw');
    const m1 = await makeMember('m1-pw');
    const m2 = await makeMember('m2-pw');

    // Current WSK wrapped for all 3 members.
    const oldWsk = generateDek();
    const ownerWrapped = wrapDek(oldWsk, owner.unlocked.publicKey).toString('base64');

    // Two pages encrypted under the OLD WSK.
    const doc1 = { type: 'doc', content: [{ type: 'paragraph', text: 'one' }] };
    const doc2 = { type: 'doc', content: [{ type: 'paragraph', text: 'two' }] };
    const encryptedPages: PageBundle[] = [
      { pageId: PAGE1, contentEncrypted: encryptPageContent(doc1, oldWsk).toString('base64') },
      { pageId: PAGE2, contentEncrypted: encryptPageContent(doc2, oldWsk).toString('base64') },
    ];

    const roster = [
      { memberUserId: ownerId, publicKey: owner.unlocked.publicKey.toString('base64') },
      { memberUserId: m1Id, publicKey: m1.unlocked.publicKey.toString('base64') },
      { memberUserId: m2Id, publicKey: m2.unlocked.publicKey.toString('base64') },
    ];

    let captured: {
      wrapped: Wrapped[];
      pageBundles: PageBundle[];
      removedMemberId: string | null;
    } | null = null;
    const fetchStub = makeFetch({
      ownerWrappedWsk: ownerWrapped,
      keyVersion: 1,
      roster,
      encryptedPages,
      capture: (b) => {
        captured = b;
      },
    });

    const result = await runRekey({
      workspaceId: WS,
      passphrase: 'owner-pw',
      sealed: owner.stored,
      removedMemberId: m2Id,
      fetch: fetchStub,
    });

    expect(result.keyVersion).toBe(2);
    expect(captured).not.toBeNull();
    const body = captured as unknown as {
      wrapped: Wrapped[];
      pageBundles: PageBundle[];
      removedMemberId: string | null;
    };

    // 5. removedMemberId echoes member2.
    expect(body.removedMemberId).toBe(m2Id);

    // 2. wrapped covers exactly owner + m1, NOT m2.
    const wrappedIds = body.wrapped.map((w) => w.memberUserId).sort();
    expect(wrappedIds).toEqual([ownerId, m1Id].sort());
    expect(wrappedIds).not.toContain(m2Id);

    // 3. each remaining member unwraps to the SAME new WSK.
    const newWskOwner = unwrapDek(
      Buffer.from(body.wrapped.find((w) => w.memberUserId === ownerId)?.wrappedWsk ?? '', 'base64'),
      owner.unlocked.privateKey,
    );
    const newWskM1 = unwrapDek(
      Buffer.from(body.wrapped.find((w) => w.memberUserId === m1Id)?.wrappedWsk ?? '', 'base64'),
      m1.unlocked.privateKey,
    );
    expect(newWskOwner.equals(newWskM1)).toBe(true);

    // 1. new WSK !== old WSK.
    expect(Buffer.compare(newWskOwner, oldWsk)).not.toBe(0);

    // 4a. remaining members decrypt the NEW page bundles to the original docs.
    const newCt1 = Buffer.from(
      body.pageBundles.find((p) => p.pageId === PAGE1)?.contentEncrypted ?? '',
      'base64',
    );
    expect(decryptPageContent(newCt1, newWskOwner)).toEqual(doc1);

    // 4b. forward secrecy: the OLD WSK does NOT decrypt the NEW ciphertext.
    expect(() => decryptPageContent(newCt1, oldWsk)).toThrow();

    // 4c. removed member (m2) has no wrapped row, so cannot derive the new WSK.
    expect(body.wrapped.find((w) => w.memberUserId === m2Id)).toBeUndefined();
  });

  it('rotateOnly (no removedMemberId) keeps all members and still rotates the WSK', async () => {
    const ownerId = '11111111-1111-1111-1111-111111111111';
    const m1Id = '22222222-2222-2222-2222-222222222222';
    const owner = await makeMember('owner-pw');
    const m1 = await makeMember('m1-pw');

    const oldWsk = generateDek();
    const ownerWrapped = wrapDek(oldWsk, owner.unlocked.publicKey).toString('base64');
    const doc = { type: 'doc', content: [] };
    const encryptedPages: PageBundle[] = [
      { pageId: PAGE1, contentEncrypted: encryptPageContent(doc, oldWsk).toString('base64') },
    ];
    const roster = [
      { memberUserId: ownerId, publicKey: owner.unlocked.publicKey.toString('base64') },
      { memberUserId: m1Id, publicKey: m1.unlocked.publicKey.toString('base64') },
    ];

    let captured: {
      wrapped: Wrapped[];
      pageBundles: PageBundle[];
      removedMemberId: string | null;
    } | null = null;
    const fetchStub = makeFetch({
      ownerWrappedWsk: ownerWrapped,
      keyVersion: 3,
      roster,
      encryptedPages,
      capture: (b) => {
        captured = b;
      },
    });

    await runRekey({
      workspaceId: WS,
      passphrase: 'owner-pw',
      sealed: owner.stored,
      removedMemberId: null,
      fetch: fetchStub,
    });

    const body = captured as unknown as {
      wrapped: Wrapped[];
      pageBundles: PageBundle[];
      removedMemberId: string | null;
    };
    expect(body.removedMemberId).toBeNull();
    expect(body.wrapped.map((w) => w.memberUserId).sort()).toEqual([ownerId, m1Id].sort());
    // WSK still rotated: unwrap and confirm it differs from oldWsk.
    const newWsk = unwrapDek(
      Buffer.from(body.wrapped[0]?.wrappedWsk ?? '', 'base64'),
      owner.unlocked.privateKey,
    );
    expect(Buffer.compare(newWsk, oldWsk)).not.toBe(0);
  });
});
