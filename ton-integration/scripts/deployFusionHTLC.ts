import { toNano } from '@ton/core';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { compile, NetworkProvider } from '@ton/blueprint';
import * as fs from 'fs';
import * as path from 'path';

export async function run(provider: NetworkProvider) {
    const fusionHTLC = provider.open(
        FusionHTLC.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                code: await compile('FusionHTLC'),
                data: await compile('FusionHTLC'),
            },
            await compile('FusionHTLC')
        )
    );

    await fusionHTLC.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(fusionHTLC.address);

    console.log('Fusion HTLC deployed at:', fusionHTLC.address.toString());
    console.log('Next HTLC ID:', await fusionHTLC.getNextHTLCId());
    
    // Save deployment info
    const deploymentInfo = {
        address: fusionHTLC.address.toString(),
        deployedAt: new Date().toISOString(),
        network: provider.network(),
    };
    
    const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log('\nDeployment info saved to:', deploymentPath);
    console.log(JSON.stringify(deploymentInfo, null, 2));
}