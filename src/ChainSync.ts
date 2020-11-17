import { SidecarApi } from './sidecar/SidecarApi';
import { MaybeTimepoint } from './transaction/types';
import { sleep } from './util';

export class ChainSync {
	private sidecarApi: SidecarApi;
	private readonly SECOND = 1_000;

	constructor(sidecarURL: string) {
		this.sidecarApi = new SidecarApi(sidecarURL);
	}

	async pollingEventListener(
		targetModule: string,
		targetMethod: string,
		not?: MaybeTimepoint,
		// Verifying event data is optional for demonstration purposes.
		targetData?: string[]
	): Promise<MaybeTimepoint> {
		while (true) {
			const block = await this.sidecarApi.getBlock();

			for (const [idx, ext] of block.extrinsics.entries()) {
				if (not !== undefined && parseInt(block.number) === not.blockHeight && idx === not.extrinsicIndex) {
					continue;
				}
				
				for (const { method: { method, pallet }, data } of ext.events) {
					if (method === 'ExtrinsicFailed') {
						throw ` !!! Unexpected extrinsic failure at block number ${block.number} 💣`;
					}

					if (method === targetMethod && pallet === targetModule) {
						if (!this.compareEventData(targetData, data)) {
							throw ` !!! Unexpected event data at block number ${block.number} 💣`;
						}

						await sleep(this.SECOND / 2);
						return {
							blockHeight: parseInt(block.number),
							extrinsicIndex: idx,
						};
					}
				}
			}

			await sleep(this.SECOND);
		}
	}

	async waitUntilHeight(height: number): Promise<number> {
		while (true) {
			const block = await this.sidecarApi.getBlock();
			const curHeight = parseInt(block.number);
			if (curHeight >= height) {
				return curHeight;
			}

			await sleep(this.SECOND);
		}
	}

	private compareEventData(expected: string[] | undefined, actual: string[]) {
		if (expected === undefined) {
			return true;
		}

		return expected.length === actual.length
		    && expected.every((ele, idx) => ele === actual[idx]);
	}
}
