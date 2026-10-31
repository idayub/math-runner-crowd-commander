# Math Runner: Crowd Commander

Hyper-casual runner / arcade shooter 3D para navegador (mobile H5 + desktop): seu exército corre sozinho por uma pista suspensa — você só controla esquerda e direita. Escolha as portas matemáticas certas (`+10`, `−5`, `×3`, `÷2`), multiplique a multidão, destrua obstáculos com HP numerado e chegue ao chefe final.

## Gameplay

- **Corrida automática** — o grupo avança sozinho; você move lateralmente (A/D, ← → ou arrastar o dedo)
- **Portas de operação** — verdes crescem o exército (`+`, `×`), vermelhas encolhem (`−`, `÷`)
- **Combate automático** — unidades atiram sozinhas em esquadrões, torres, barris e chefes com HP numerado; se um obstáculo sobreviver até o contato, cada ponto de HP elimina 1 soldado
- **Upgrades entre fases** — moedas coletadas na pista compram Exército Inicial, Cadência de Tiro e Dano (10 níveis cada)
- **Dificuldade escalável** — velocidade, HP e complexidade das contas aumentam por nível

## Stack

- [Three.js](https://threejs.org/) — render 3D, multidão via `InstancedMesh`, loop de timestep fixo
- React + TypeScript + Vite — HUD/menus em DOM, loop do jogo 100% fora do React
- Web Audio API — SFX e música 100% sintetizados (sem arquivos de áudio)
- `localStorage` — progresso local (nível, moedas, upgrades)

## Rodando localmente

```bash
npm install
npm run dev        # desenvolvimento com HMR
npm run build      # build de produção em dist/
npm run preview    # serve o build
npm run verify     # self-check: serve dist/, screenshots de 3 estados, zero erros de console
```

## Estrutura

```
src/
  game/
    boot.ts     — cena Three.js, loop, input, tiro, colisões, partículas
    level.ts    — geração procedural de fases (seeded, determinística)
    engine.ts   — game loop de timestep fixo (60 Hz)
    input.ts    — teclado + mouse + toque
    audio.ts    — SFX/música sintetizados
    state.ts    — máquina de estados (title → playing ⇄ paused → levelup/gameover)
    storage.ts  — persistência local
  pages/Home.tsx — HUD e telas (título, pausa, level-up, game over)
```

Feito com [Kimi](https://www.kimi.com/) 🎮
