import { MaybeTimepoint } from '../transaction/types';

export function logSeparator(): void {
	console.log(Array(80).fill('━').join(''), '\n');
}

export function describeTransaction(desc: string): void {
	console.log(` >>> ${desc}...`);
}

export function submitting(): void {
	console.log('  >> Submitting transaction to Caliente node 🚀');
}

export function response(): void {
	console.log(`  >> Received response 👀`);
}

export function waiting(): void {
	console.log('  >> Waiting for transaction inclusion ⌛️');
}

export function success(includedAt: MaybeTimepoint): void {
	console.log(
		` >>> Successfully included at block #${includedAt.blockHeight}, index ${includedAt.extrinsicIndex}!`
	);
}
