export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  logo?: string;
  coingeckoId?: string;
  wrapped?: boolean;
}

export interface TokenPair {
  sourceToken: TokenInfo;
  targetToken: TokenInfo;
  pairType: 'native' | 'wrapped' | 'synthetic' | 'bridged';
}

export class TokenRegistry {
  private tokens: Map<string, TokenInfo> = new Map();
  private pairs: Map<string, TokenPair[]> = new Map();

  constructor() {
    this.initializeTokens();
    this.initializePairs();
  }

  private initializeTokens() {
    // Stellar tokens
    this.addToken({
      address: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      decimals: 7,
      chain: 'stellar',
      coingeckoId: 'stellar'
    });

    this.addToken({
      address: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 7,
      chain: 'stellar',
      coingeckoId: 'usd-coin'
    });

    this.addToken({
      address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      symbol: 'USDT',
      name: 'Tether',
      decimals: 7,
      chain: 'stellar',
      coingeckoId: 'tether'
    });

    // Ethereum/Sepolia tokens
    this.addToken({
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chain: 'ethereum',
      coingeckoId: 'ethereum'
    });

    this.addToken({
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chain: 'sepolia',
      coingeckoId: 'ethereum'
    });

    this.addToken({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chain: 'ethereum',
      coingeckoId: 'usd-coin'
    });

    this.addToken({
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chain: 'sepolia',
      coingeckoId: 'usd-coin'
    });

    // Wrapped tokens
    this.addToken({
      address: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      symbol: 'wETH',
      name: 'Wrapped Ethereum',
      decimals: 7,
      chain: 'stellar',
      wrapped: true,
      coingeckoId: 'ethereum'
    });

    this.addToken({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      chain: 'ethereum',
      wrapped: true,
      coingeckoId: 'ethereum'
    });
  }

  private initializePairs() {
    // XLM <-> ETH
    this.addPair({
      sourceToken: this.getToken('stellar', 'XLM')!,
      targetToken: this.getToken('ethereum', 'ETH')!,
      pairType: 'native'
    });

    this.addPair({
      sourceToken: this.getToken('stellar', 'XLM')!,
      targetToken: this.getToken('sepolia', 'ETH')!,
      pairType: 'native'
    });

    // USDC pairs (cross-chain stablecoins)
    this.addPair({
      sourceToken: this.getToken('stellar', 'USDC')!,
      targetToken: this.getToken('ethereum', 'USDC')!,
      pairType: 'bridged'
    });

    this.addPair({
      sourceToken: this.getToken('stellar', 'USDC')!,
      targetToken: this.getToken('sepolia', 'USDC')!,
      pairType: 'bridged'
    });

    // Wrapped ETH on Stellar
    this.addPair({
      sourceToken: this.getToken('stellar', 'wETH')!,
      targetToken: this.getToken('ethereum', 'ETH')!,
      pairType: 'wrapped'
    });

    this.addPair({
      sourceToken: this.getToken('ethereum', 'ETH')!,
      targetToken: this.getToken('stellar', 'wETH')!,
      pairType: 'wrapped'
    });
  }

  private addToken(token: TokenInfo) {
    const key = `${token.chain}:${token.address}`;
    this.tokens.set(key, token);
  }

  private addPair(pair: TokenPair) {
    const key = `${pair.sourceToken.chain}:${pair.targetToken.chain}`;
    const pairs = this.pairs.get(key) || [];
    pairs.push(pair);
    this.pairs.set(key, pairs);

    // Also add reverse pair
    const reverseKey = `${pair.targetToken.chain}:${pair.sourceToken.chain}`;
    const reversePairs = this.pairs.get(reverseKey) || [];
    reversePairs.push({
      sourceToken: pair.targetToken,
      targetToken: pair.sourceToken,
      pairType: pair.pairType
    });
    this.pairs.set(reverseKey, reversePairs);
  }

  getToken(chain: string, symbolOrAddress: string): TokenInfo | null {
    // Try by address first
    let key = `${chain}:${symbolOrAddress}`;
    if (this.tokens.has(key)) {
      return this.tokens.get(key)!;
    }

    // Try by symbol
    for (const [k, token] of this.tokens) {
      if (token.chain === chain && token.symbol === symbolOrAddress) {
        return token;
      }
    }

    return null;
  }

  getTokenByAddress(chain: string, address: string): TokenInfo | null {
    const key = `${chain}:${address}`;
    return this.tokens.get(key) || null;
  }

  getSupportedPairs(sourceChain: string, targetChain: string): TokenPair[] {
    const key = `${sourceChain}:${targetChain}`;
    return this.pairs.get(key) || [];
  }

  getAllTokens(chain?: string): TokenInfo[] {
    const tokens: TokenInfo[] = [];
    for (const token of this.tokens.values()) {
      if (!chain || token.chain === chain) {
        tokens.push(token);
      }
    }
    return tokens;
  }

  isTokenSupported(chain: string, address: string): boolean {
    const key = `${chain}:${address}`;
    return this.tokens.has(key);
  }

  findMatchingToken(sourceToken: TokenInfo, targetChain: string): TokenInfo | null {
    // Find best matching token on target chain
    const pairs = this.getSupportedPairs(sourceToken.chain, targetChain);
    
    for (const pair of pairs) {
      if (pair.sourceToken.address === sourceToken.address) {
        return pair.targetToken;
      }
    }

    // Try to find by symbol (for cross-chain tokens like USDC)
    for (const token of this.tokens.values()) {
      if (token.chain === targetChain && token.symbol === sourceToken.symbol) {
        return token;
      }
    }

    return null;
  }
}