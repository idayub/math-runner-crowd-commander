/**
 * Home.tsx — page shell for Math Runner: Crowd Commander.
 * React owns only the DOM HUD/menus; the Three.js game loop lives in src/game/boot.ts
 * and pushes UiState snapshots here. All buttons call the GameApi returned by startGame.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Play, Pause, RotateCcw, Home as HomeIcon, Volume2, VolumeX,
  Coins, Users, Zap, Sword, Trophy, ChevronRight,
} from 'lucide-react'
import { startGame, stopGame, type GameApi, type UiState, type UpgradeKey } from '@/game/boot'

const UPGRADE_META: Record<UpgradeKey, { name: string; desc: string; icon: typeof Users }> = {
  army: { name: 'Exército Inicial', desc: '+4 soldados por nível', icon: Users },
  rate: { name: 'Cadência de Tiro', desc: 'atira mais rápido', icon: Zap },
  dmg: { name: 'Dano', desc: '+1 de dano por tiro', icon: Sword },
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const apiRef = useRef<GameApi | null>(null)
  const [ui, setUi] = useState<UiState | null>(null)
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    apiRef.current = startGame(canvas, setUi)
    const t = setTimeout(() => setShowHint(false), 6000)
    return () => {
      clearTimeout(t)
      stopGame()
      apiRef.current = null
    }
  }, [])

  const api = apiRef.current
  const phase = ui?.phase ?? 'title'

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />

      {/* ---------- in-game HUD ---------- */}
      {(phase === 'playing' || phase === 'paused') && ui && (
        <div className="hud-top">
          <div className="hud-row">
            <span className="pill pill-level">Nível {ui.level}</span>
            <span className="pill pill-count">
              <Users size={20} /> {ui.count}
            </span>
            <span className="pill pill-coins">
              <Coins size={18} /> {ui.coins}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${ui.progress * 100}%` }} />
          </div>
          <div className="hud-buttons">
            <button className="icon-btn" onClick={() => api?.togglePause()} aria-label="Pausar">
              {phase === 'paused' ? <Play size={22} /> : <Pause size={22} />}
            </button>
            <button className="icon-btn" onClick={() => api?.toggleMute()} aria-label="Som">
              {ui.muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
          </div>
          {showHint && phase === 'playing' && (
            <div className="drag-hint">◀ arraste para mover ▶</div>
          )}
        </div>
      )}

      {/* ---------- title ---------- */}
      {phase === 'title' && ui && (
        <div className="screen">
          <div className="card title-card">
            <h1 className="game-logo">
              MATH <span>RUNNER</span>
            </h1>
            <p className="game-sub">Crowd Commander</p>
            <p className="game-desc">
              Multiplique seu exército nas portas certas e destrua tudo no caminho!
            </p>
            <button className="btn btn-primary" onClick={() => api?.start()}>
              <Play size={22} /> Jogar — Nível {ui.level}
            </button>
            <div className="title-stats">
              <span className="pill pill-coins"><Coins size={16} /> {ui.coins}</span>
              <span className="pill"><Trophy size={16} /> Nível máx. {ui.best}</span>
              <button className="icon-btn" onClick={() => api?.toggleMute()} aria-label="Som">
                {ui.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            </div>
            <UpgradeShop ui={ui} api={api} />
            <p className="controls-hint">A/D ou ← → no teclado · arraste no celular</p>
          </div>
        </div>
      )}

      {/* ---------- pause ---------- */}
      {phase === 'paused' && (
        <div className="screen dim">
          <div className="card">
            <h2>Pausado</h2>
            <button className="btn btn-primary" onClick={() => api?.togglePause()}>
              <Play size={20} /> Continuar
            </button>
            <button className="btn" onClick={() => api?.restart()}>
              <RotateCcw size={20} /> Reiniciar Nível
            </button>
            <button className="btn btn-ghost" onClick={() => api?.quitToTitle()}>
              <HomeIcon size={20} /> Menu
            </button>
          </div>
        </div>
      )}

      {/* ---------- level complete / upgrades ---------- */}
      {phase === 'levelup' && ui && (
        <div className="screen">
          <div className="card">
            <h2 className="win-title">🎉 Nível {ui.level - 1} completo!</h2>
            <p className="game-desc">+{ui.gain} moedas coletadas · bônus incluído</p>
            <UpgradeShop ui={ui} api={api} />
            <button className="btn btn-primary" onClick={() => api?.nextLevel()}>
              Próximo Nível <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {/* ---------- game over ---------- */}
      {phase === 'gameover' && ui && (
        <div className="screen dim">
          <div className="card">
            <h2 className="lose-title">Exército eliminado!</h2>
            <p className="game-desc">
              Você chegou ao nível {ui.level} · <Coins size={15} /> {ui.coins} moedas
            </p>
            <UpgradeShop ui={ui} api={api} />
            <button className="btn btn-primary" onClick={() => api?.restart()}>
              <RotateCcw size={20} /> Tentar de Novo
            </button>
            <button className="btn btn-ghost" onClick={() => api?.quitToTitle()}>
              <HomeIcon size={20} /> Menu
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UpgradeShop({ ui, api }: { ui: UiState; api: GameApi | null }) {
  return (
    <div className="shop">
      <p className="shop-title">Melhorias</p>
      <div className="shop-grid">
        {(Object.keys(UPGRADE_META) as UpgradeKey[]).map((k) => {
          const meta = UPGRADE_META[k]
          const lv = ui.upgrades[k]
          const cost = ui.costs[k]
          const maxed = lv >= 10
          const afford = ui.coins >= cost
          const Icon = meta.icon
          return (
            <button
              key={k}
              className={`shop-card ${afford && !maxed ? 'afford' : ''}`}
              disabled={maxed || !afford}
              onClick={() => api?.buyUpgrade(k)}
            >
              <Icon size={22} />
              <span className="shop-name">{meta.name}</span>
              <span className="shop-lv">Nv. {lv}</span>
              <span className="shop-desc">{meta.desc}</span>
              <span className="shop-cost">
                {maxed ? 'MÁX' : (<><Coins size={14} /> {cost}</>)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
