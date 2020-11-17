import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';

export interface DemoKeys {
	// "Cold" account.
	// Ref: https://wiki.polkadot.network/docs/en/learn-keys#controller-and-stash-keys
	coldAcct: KeyringPair;
	// Ref: https://wiki.polkadot.network/docs/en/learn-accounts#multi-signature-accounts
	multisig0: KeyringPair;
	multisig1: KeyringPair;
	multisig2: KeyringPair;
	// Ref: https://wiki.polkadot.network/docs/en/learn-accounts#proxy-accounts
	proxy: KeyringPair;
	// Dummy account used for funds.
	bank: KeyringPair;
	// 🕵️
	attacker: KeyringPair;
}

// Create well-known keys keys for demonstration purposes.
// Ref: https://substrate.dev/docs/en/knowledgebase/integrate/subkey#well-known-keys
export async function createDemoKeyPairs(): Promise<DemoKeys> {
	await cryptoWaitReady();
	const keyring: Keyring = new Keyring();

	// Each key is created with a URI, some metadata, and a key type
	const alice = keyring.addFromUri(
		// URI
		'//Alice',
		// Metadata
		{ name: 'Alice' },
		// Key type
		'sr25519'
	);

	const aliceStash = keyring.addFromUri(
		'//Alice//stash',
		{ name: 'Alice Stash' },
		'sr25519'
	);

	const bob = keyring.addFromUri(
		'//Bob',
		{ name: 'Bob' },
		'sr25519'
	);

	const dave = keyring.addFromUri(
		'//Dave',
		{ name: 'Dave' },
		'sr25519'
	);

	const eve = keyring.addFromUri(
		'//Eve',
		{ name: 'Eve' },
		'sr25519'
	);

	const charlie = keyring.addFromUri(
		'//Charlie',
		{ name: 'Charlie' },
		'sr25519'
	);

	const attacker = keyring.addFromUri(
		'//Attacker',
		{ name: 'Attacker' },
		'sr25519'
	);

	return {
		coldAcct: aliceStash,
		multisig0: alice,
		multisig1: bob,
		multisig2: dave,
		proxy: eve,
		bank: charlie,
		attacker,
	};
}
