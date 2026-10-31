# scripts

- `build-output.ts` — plugin Vite que valida o conteúdo emitido no build e limpa artefatos antigos.
- `verify-game.mjs` — self-check com Playwright: serve `dist/`, tira screenshots de 3 estados (título, gameplay, pausa), valida zero erros de console e o mapeamento de direção (A/D movem a câmera/lateral corretamente).

Uso:

```bash
npm run build && node scripts/verify-game.mjs
```
