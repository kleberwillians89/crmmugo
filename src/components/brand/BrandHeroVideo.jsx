import { useEffect, useRef, useState } from 'react'

const VIDEO_SOURCE = '/Mugo-3dlogo-1080p-new (1).mp4'

export function BrandHeroVideo() {
  const videoRef = useRef(null)
  const [canLoadVideo, setCanLoadVideo] = useState(false)

  useEffect(() => {
    const isSmallScreen = window.matchMedia('(max-width: 720px)').matches
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const saveData = navigator.connection?.saveData === true

    if (isSmallScreen || reduceMotion || saveData) return undefined

    const revealVideo = () => setCanLoadVideo(true)
    const idleId = window.requestIdleCallback?.(revealVideo, { timeout: 1200 })
    const timeoutId = idleId === undefined ? window.setTimeout(revealVideo, 0) : undefined

    return () => {
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !canLoadVideo) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        video.play().catch(() => {})
      } else {
        video.pause()
      }
    }, { threshold: 0.15 })

    observer.observe(video)
    return () => observer.disconnect()
  }, [canLoadVideo])

  return (
    <div className="brand-hero-video" aria-hidden="true">
      {canLoadVideo ? (
        <video
          ref={videoRef}
          aria-hidden="true"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster="/favicon.png"
          tabIndex="-1"
        >
          <source src={VIDEO_SOURCE} type="video/mp4" />
        </video>
      ) : (
        <img src="/favicon.png" alt="" loading="eager" decoding="async" />
      )}
      <span className="brand-hero-overlay" />
    </div>
  )
}
