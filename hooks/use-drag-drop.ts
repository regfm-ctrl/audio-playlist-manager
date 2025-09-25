"use client"

import type React from "react"

import { useState, useRef } from "react"

export interface DragDropState {
  isDragging: boolean
  draggedItem: any | null
  dropTarget: string | null
}

export function useDragDrop() {
  const [state, setState] = useState<DragDropState>({
    isDragging: false,
    draggedItem: null,
    dropTarget: null,
  })

  const dragCounter = useRef(0)

  const handleDragStart = (item: any) => {
    setState((prev) => ({
      ...prev,
      isDragging: true,
      draggedItem: item,
    }))
  }

  const handleDragEnd = () => {
    setState({
      isDragging: false,
      draggedItem: null,
      dropTarget: null,
    })
    dragCounter.current = 0
  }

  const handleDragEnter = (targetId: string) => {
    dragCounter.current++
    setState((prev) => ({
      ...prev,
      dropTarget: targetId,
    }))
  }

  const handleDragLeave = () => {
    dragCounter.current--
    if (dragCounter.current === 0) {
      setState((prev) => ({
        ...prev,
        dropTarget: null,
      }))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, onDrop: (item: any) => void) => {
    e.preventDefault()
    if (state.draggedItem) {
      onDrop(state.draggedItem)
    }
    handleDragEnd()
  }

  return {
    state,
    handleDragStart,
    handleDragEnd,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  }
}
