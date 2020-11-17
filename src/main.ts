import { blake2AsHex } from '@polkadot/util-crypto';
import {
	encodeDerivedAddress,
	encodeMultiAddress,
} from '@polkadot/util-crypto';

import { ChainSync } from './ChainSync';
import { createDemoKeyPairs, DemoKeys } from './keyring';
import { SidecarApi } from './sidecar/SidecarApi';
import { TransactionConstruct } from './transaction/TransactionConstruct';
import {
	logSeparator,
	describeTransaction,
	submitting,
	response,
	waiting,
	success,
	waitToContinue,
	sortAddresses,
} from './util';

const SIDECAR_URL = 'http://127.0.0.1:8080';

const CALIENTE_CHAIN_PROPERTIES = {
	ss58Format: 42,
	tokenDecimals: 12,
	tokenSymbol: null,
};

async function main() {
	const keys = await createDemoKeyPairs();

	// Ref: https://wiki.polkadot.network/docs/en/learn-accounts#multi-signature-accounts
	describeTransaction('Create and fund a multisig account');
	await waitToContinue();

	const addresses = [
		keys.multisig0.address,
		keys.multisig1.address,
		keys.multisig2.address,
	];
	const multisigThreshold = 2;
	const ss58Prefix = CALIENTE_CHAIN_PROPERTIES.ss58Format;
	const multisigAcct = encodeMultiAddress(
		addresses,
		multisigThreshold,
		ss58Prefix
	);

	console.log(' >>> Created multisig account ✍️');
	console.log('  >> Component Accounts:');
	addresses.forEach((address) => console.log('   > ' + address));
	console.log(`  >> Signature Threshold: ${multisigThreshold}`);
	console.log(`  >> Multisig Address: ${multisigAcct}\n`);

	// Helpers for encoding signed transactions.
	const transactionConstruct = new TransactionConstruct(
		SIDECAR_URL,
		CALIENTE_CHAIN_PROPERTIES
	);
	// Helpers for interacting with the Sidecar REST API.
	const sidecarApi = new SidecarApi(SIDECAR_URL);
	// Helpers for blocking until completion of on-chain transactions.
	const chainSync = new ChainSync(SIDECAR_URL);

	// Load up multisig account with currency so it can make transactions.
	const transferValue = '999999999999999';
	describeTransaction(
		`Transferring ${transferValue} units from Alice to multisig account`
	);

	const transferToMultiSigCall = await transactionConstruct.balancesTransfer(
		{ origin: keys.multisig0.address },
		multisigAcct,
		transferValue
	);
	const signedTransferToMultiSigCall = transactionConstruct.createAndSignTransaction(
		keys.multisig0,
		transferToMultiSigCall
	);
	submitting();

	await sidecarApi.submitTransaction(signedTransferToMultiSigCall);
	response();
	waiting();

	const transferToMultisigTimepoint = await chainSync.pollingEventListener(
		'balances',
		'Transfer'
	);
	success(transferToMultisigTimepoint);

	logSeparator();

	const delayPeriodInBlocks = 6;
	const maxWeight = 1000000000;

	// Make Eve a time-delay proxy for the multisig account. Eve will be able to execute
	// transactions up to some maximum weight on behalf of the multisig account, but will have
	// to announce the intention to do so and allow for a delay during which time a transaction
	// may be canceled.
	describeTransaction('Add Eve as time-delay proxy for multisig account');
	await waitToContinue();
	await setupProxyForMultisig(
		multisigAcct,
		transactionConstruct,
		chainSync,
		sidecarApi,
		keys,
		ss58Prefix,
		delayPeriodInBlocks,
		maxWeight
	);

	describeTransaction(
		'Create two derived accounts from the multisig account and fund them'
	);
	await waitToContinue();

	const derivedAddr0 = encodeDerivedAddress(multisigAcct, 0, ss58Prefix);
	const derivedAddr1 = encodeDerivedAddress(multisigAcct, 1, ss58Prefix);

	console.log(' >>> Created derived accounts 👶');
	console.log('  >> Derived Address #1: ' + derivedAddr0);
	console.log('  >> Derived Address #2: ' + derivedAddr1);
	console.log();
	await fundDerivedAccts(
		transactionConstruct,
		chainSync,
		sidecarApi,
		keys,
		derivedAddr0,
		derivedAddr1
	);

	describeTransaction(
		'Use proxy address to send funds from multisig account to cold account'
	);
	await waitToContinue();
	await happyPath(
		transactionConstruct,
		chainSync,
		sidecarApi,
		keys,
		derivedAddr0,
		multisigAcct,
		delayPeriodInBlocks
	);

	// An attacker compromises the proxy and uses the proxy to send funds from the second
	// derived account to the attacker's address. The safety worker will see the announcement
	// for the proxy call and alert the system that there is a transfer from a derivative
	// address that does not go to cold storage. The system will then have two of the component
	// addresses for the multisig create a transaction to remove all proxies from the multisig
	// address and thus prevent the attacker from making the call as a proxy.
	describeTransaction("Demonstrate the hot wallet's security capabilities");
	await waitToContinue();
	await adversarialPath(
		transactionConstruct,
		chainSync,
		sidecarApi,
		keys,
		derivedAddr1,
		multisigAcct,
		delayPeriodInBlocks,
		maxWeight
	);
}

main().catch(console.log);

// Helper function to add Eve as a time-delay proxy for the multisig account.
async function setupProxyForMultisig(
	multisigAddr: string,
	transactionConstruct: TransactionConstruct,
	chainSync: ChainSync,
	sidecarApi: SidecarApi,
	keys: DemoKeys,
	ss58Prefix: number,
	delayPeriod: number,
	maxWeight: number
): Promise<void> {
	const {
		unsigned: { method: addProxyEveMethod },
	} = await transactionConstruct.proxyAddProxy(
		{ origin: multisigAddr },
		keys.proxy.address,
		'Any',
		delayPeriod
	);
	const addProxyEveHash = blake2AsHex(addProxyEveMethod, 256);

	describeTransaction(`Approving multisig transaction as Bob`);
	const bobApproveAsMulti = await transactionConstruct.multiSigApproveAsMulti(
		{ origin: keys.multisig1.address },
		2,
		sortAddresses(
			[keys.multisig0.address, keys.multisig2.address],
			ss58Prefix
		),
		null,
		addProxyEveHash,
		maxWeight
	);
	const signedApproveAsMulti = transactionConstruct.createAndSignTransaction(
		keys.multisig1,
		bobApproveAsMulti
	);
	submitting();

	await sidecarApi.submitTransaction(signedApproveAsMulti);
	response();
	waiting();

	const bobApproveAsMultiTimepoint = await chainSync.pollingEventListener(
		'multisig',
		'NewMultisig'
	);
	success(bobApproveAsMultiTimepoint);
	console.log();

	describeTransaction(`Approving & executing multisig transaction as Dave`);
	const daveAsMulti = await transactionConstruct.multiSigAsMulti(
		{ origin: keys.multisig2.address },
		2,
		sortAddresses(
			[keys.multisig0.address, keys.multisig1.address],
			ss58Prefix
		),
		bobApproveAsMultiTimepoint,
		addProxyEveMethod,
		false,
		maxWeight
	);
	const signedAsMulti = transactionConstruct.createAndSignTransaction(
		keys.multisig2,
		daveAsMulti
	);
	submitting();

	await sidecarApi.submitTransaction(signedAsMulti);
	response();
	waiting();

	const daveAsMultiTimepoint = await chainSync.pollingEventListener(
		'multisig',
		'MultisigExecuted'
	);
	success(daveAsMultiTimepoint);
	logSeparator();
}

async function fundDerivedAccts(
	transactionConstruct: TransactionConstruct,
	chainSync: ChainSync,
	sidecarApi: SidecarApi,
	keys: DemoKeys,
	deriveAddr0: string,
	deriveAddr1: string
): Promise<void> {
	const transferValue = '999999999999999';

	describeTransaction(
		`Transferring ${transferValue} units from Charlie to first derived address`
	);
	const transferToD0 = await transactionConstruct.balancesTransfer(
		{ origin: keys.bank.address },
		deriveAddr0,
		transferValue
	);
	const signedTransferToD0 = transactionConstruct.createAndSignTransaction(
		keys.bank,
		transferToD0
	);
	submitting();

	await sidecarApi.submitTransaction(signedTransferToD0);
	response();
	waiting();

	const transferToD0Timepoint = await chainSync.pollingEventListener(
		'balances',
		'Transfer'
	);
	success(transferToD0Timepoint);
	console.log();

	describeTransaction(
		`Transferring ${transferValue} units from Charlie to second derived address`
	);
	const transferToD1 = await transactionConstruct.balancesTransfer(
		{
			origin: keys.bank.address,
			height: transferToD0Timepoint.blockHeight + 1,
		},
		deriveAddr1,
		transferValue
	);
	const signedTransferToD1 = transactionConstruct.createAndSignTransaction(
		keys.bank,
		transferToD1
	);
	submitting();

	await sidecarApi.submitTransaction(signedTransferToD1);
	response();
	waiting();

	const transferToD1Timepoint = await chainSync.pollingEventListener(
		'balances',
		'Transfer',
		transferToD0Timepoint
	);
	success(transferToD1Timepoint);
	logSeparator();
}

// Use proxy account to send funds from multisig account to cold account.
async function happyPath(
	transactionConstruct: TransactionConstruct,
	chainSync: ChainSync,
	sidecarApi: SidecarApi,
	keys: DemoKeys,
	deriveAddr0: string,
	multisigAddr: string,
	delayPeriod: number
): Promise<void> {
	describeTransaction(
		`Announcing the proxy account's intent to transfer funds from the first derived account to the cold account`
	);

	const {
		unsigned: transferToColdStorage,
		registry: transferToColdStorageRegistry,
		metadataRpc: transferToColdStorageMetadataRpc,
	} = await transactionConstruct.balancesTransfer(
		{ origin: deriveAddr0 },
		keys.coldAcct.address,
		'1'
	);
	const {
		unsigned: derivedTransfer,
	} = await transactionConstruct.utilityAsDerivative(
		{ origin: multisigAddr },
		0,
		transferToColdStorage.method
	);
	const derivedMethod = derivedTransfer.method;
	const derivedHash = blake2AsHex(derivedMethod, 256);
	const proxyAnnounceDerived = await transactionConstruct.proxyAnnounce(
		{ origin: keys.proxy.address },
		multisigAddr,
		derivedHash
	);
	const signedProxyAnnounceC0 = transactionConstruct.createAndSignTransaction(
		keys.proxy,
		proxyAnnounceDerived
	);
	submitting();

	await sidecarApi.submitTransaction(signedProxyAnnounceC0);
	response();
	waiting();

	const announcedTimepoint = await chainSync.pollingEventListener(
		'proxy',
		'Announced'
	);
	success(announcedTimepoint);
	console.log();

	describeTransaction('Check safety of the announced transaction.');
	await waitToContinue();

	const transactionSafety = transactionConstruct.safetyWorker(
		{
			unsigned: transferToColdStorage,
			registry: transferToColdStorageRegistry,
			metadataRpc: transferToColdStorageMetadataRpc,
		},
		keys.coldAcct.address
	);

	if (transactionSafety) {
		console.log('  >> Transaction safety confirmed 😌');
	} else {
		console.log('  !! Transaction is not safe - bailing 💣');
		return;
	}

	describeTransaction(
		`Waiting ${delayPeriod} blocks for the delay period to pass`
	);
	await chainSync.waitUntilHeight(
		announcedTimepoint.blockHeight + delayPeriod
	);
	console.log();

	describeTransaction(
		`Using the proxy account to send funds from the first derived account to the cold account`
	);
	const proxyAnnounced = await transactionConstruct.proxyProxyAnnounced(
		{ origin: keys.proxy.address },
		multisigAddr,
		keys.proxy.address,
		'Any',
		derivedMethod
	);
	const signedProxyAnnounced = transactionConstruct.createAndSignTransaction(
		keys.proxy,
		proxyAnnounced
	);
	submitting();
	await sidecarApi.submitTransaction(signedProxyAnnounced);
	response();
	waiting();

	const transferTimepoint = await chainSync.pollingEventListener(
		'balances',
		'Transfer'
	);
	success(transferTimepoint);
	logSeparator();
}

async function adversarialPath(
	transactionConstruct: TransactionConstruct,
	chainSync: ChainSync,
	sidecarApi: SidecarApi,
	keys: DemoKeys,
	deriveAddr1: string,
	multisigAddr: string,
	delayPeriod: number,
	maxWeight: number
): Promise<void> {
	describeTransaction(
		`The proxy account has been compromised and is announcing intent to transfer funds from the first derived account to an attacker's account`
	);

	const {
		unsigned: transferToAttacker,
		registry: transferToAttackerRegistry,
		metadataRpc: transferToAttackerMetadataRpc,
	} = await transactionConstruct.balancesTransfer(
		{ origin: deriveAddr1 },
		keys.attacker.address,
		'999999999999999'
	);
	const {
		unsigned: derivedTransfer,
	} = await transactionConstruct.utilityAsDerivative(
		{ origin: multisigAddr },
		1,
		transferToAttacker.method
	);
	const derivedMethod = derivedTransfer.method;
	const derivedHash = blake2AsHex(derivedMethod, 256);
	const proxyAnnounceC1 = await transactionConstruct.proxyAnnounce(
		{ origin: keys.proxy.address },
		multisigAddr,
		derivedHash
	);
	const signedProxyAnnounceC1 = transactionConstruct.createAndSignTransaction(
		keys.proxy,
		proxyAnnounceC1
	);
	submitting();

	await sidecarApi.submitTransaction(signedProxyAnnounceC1);
	response();
	waiting();

	const announcedTimepoint = await chainSync.pollingEventListener(
		'proxy',
		'Announced'
	);
	success(announcedTimepoint);
	console.log();

	describeTransaction(
		`In ${delayPeriod} blocks the attacker will use the proxy to transfer funds to their account`
	);
	void chainSync
		.waitUntilHeight(announcedTimepoint.blockHeight + delayPeriod)
		.then(async () => {
			console.log(' !!! Attacker is attempting to transfer funds...');
			const proxyAnnouncedCallC1 = await transactionConstruct.proxyProxyAnnounced(
				{ origin: keys.proxy.address },
				multisigAddr,
				keys.proxy.address,
				'Any',
				derivedMethod
			);
			const signedProxyAnnouncedTxC1 = transactionConstruct.createAndSignTransaction(
				keys.proxy,
				proxyAnnouncedCallC1
			);
			console.log('  !! Malicious transaction submitted 😲');

			await sidecarApi.submitTransaction(signedProxyAnnouncedTxC1);
			console.log(`  !! Received response 👀`);
			console.log('  !! Waiting for transaction inclusion ⌛️');
			try {
				const transferTimepoint = await chainSync.pollingEventListener(
					'balances',
					'Transfer'
				);
				console.log(
					` !!! Malicious transaction included at block #${transferTimepoint.blockHeight}, index ${transferTimepoint.extrinsicIndex} 😭`
				);
			} catch {
				console.log('\n🎉 Malicious transaction averted! 🎉\n');
			}
		});

	describeTransaction(`Checking transaction safety`);
	const isSafe = transactionConstruct.safetyWorker(
		{
			unsigned: transferToAttacker,
			registry: transferToAttackerRegistry,
			metadataRpc: transferToAttackerMetadataRpc,
		},
		keys.coldAcct.address
	);

	if (isSafe) {
		throw 'Failed to identify malicious transaction!';
	}

	console.log(
		'\n🚧 Malicious proxy transfer detected! Kicking off proxy removal protocol! 🚧\n'
	);

	describeTransaction(`Approving removal of proxies from multisig as Alice`);
	const {
		unsigned: { method: removeProxiesMethod },
	} = await transactionConstruct.proxyRemoveProxies({ origin: multisigAddr });
	const removeProxiesHash = blake2AsHex(removeProxiesMethod);
	const approveRemoveProxies = await transactionConstruct.multiSigApproveAsMulti(
		{ origin: keys.multisig0.address },
		2,
		sortAddresses([keys.multisig1.address, keys.multisig2.address]),
		null,
		removeProxiesHash,
		maxWeight
	);
	const signedRemoveProxiesApproveAsMulti = transactionConstruct.createAndSignTransaction(
		keys.multisig0,
		approveRemoveProxies
	);
	submitting();

	await sidecarApi.submitTransaction(signedRemoveProxiesApproveAsMulti);
	response();
	waiting();

	const approveRemoveProxiesTimepoint = await chainSync.pollingEventListener(
		'multisig',
		'NewMultisig'
	);
	success(approveRemoveProxiesTimepoint);
	console.log();

	describeTransaction(
		`Approving & executing removal of proxies from multisig as Bob`
	);
	const removeProxiesAsMulti = await transactionConstruct.multiSigAsMulti(
		{ origin: keys.multisig1.address },
		2,
		sortAddresses([keys.multisig0.address, keys.multisig2.address]),
		approveRemoveProxiesTimepoint,
		removeProxiesMethod,
		true,
		maxWeight
	);
	const signedRemoveProxiesAsMulti = transactionConstruct.createAndSignTransaction(
		keys.multisig1,
		removeProxiesAsMulti
	);
	submitting();

	await sidecarApi.submitTransaction(signedRemoveProxiesAsMulti);
	response();
	waiting();

	const removeProxiesTimepoint = await chainSync.pollingEventListener(
		'proxy',
		'ProxyExecuted'
	);
	success(removeProxiesTimepoint);

	console.log(
		' >>> All proxies have been removed from the multisig account 😌'
	);
}
