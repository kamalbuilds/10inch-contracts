import { toNano } from '@ton/core';
import { FusionPlus } from '../wrappers/FusionPlus';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const fusionPlus = provider.open(
        FusionPlus.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                counter: 0,
            },
            await compile('FusionPlus')
        )
    );

    await fusionPlus.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(fusionPlus.address);

    console.log('ID', await fusionPlus.getID());
}
