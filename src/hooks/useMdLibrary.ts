import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { MdDoc, MdDocContent } from '../lib/types'

/** notes 数据库列表 + 搜索过滤 + 手动刷新 */
export function useMdLibrary() {
  const [docs, setDocs] = useState<MdDoc[]>([])
  const [mdDir, setMdDir] = useState('')
  const [totalChars, setTotalChars] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback((force = false) => {
    setLoading(true)
    setError(null)
    api
      .listMd(force)
      .then((data) => {
        setDocs(data.docs)
        setMdDir(data.mdDir)
        setTotalChars(data.totalChars)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh(false)
  }, [refresh])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return docs
    return docs.filter((doc) => {
      if (doc.docId.toLowerCase().includes(keyword)) return true
      if (doc.title.toLowerCase().includes(keyword)) return true
      if (doc.summary.toLowerCase().includes(keyword)) return true
      return doc.headings.some((heading) => heading.text.toLowerCase().includes(keyword))
    })
  }, [docs, query])

  return { docs, filtered, mdDir, totalChars, loading, error, query, setQuery, refresh }
}

/** 按需读取单篇文档原文 */
export function useMdContent(docId: string | null) {
  const [doc, setDoc] = useState<MdDocContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!docId) {
      setDoc(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .readMd(docId)
      .then((data) => {
        if (alive) setDoc(data.doc)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [docId])

  return { doc, loading, error }
}

/** 统计每个文档被多少节点引用，用于列表徽标 */
export function countRefs(docs: MdDoc[], nodes: { refs: { docId: string }[] }[]) {
  const map = new Map<string, number>()
  docs.forEach((doc) => map.set(doc.docId, 0))
  nodes.forEach((node) => {
    node.refs.forEach((ref) => {
      map.set(ref.docId, (map.get(ref.docId) ?? 0) + 1)
    })
  })
  return map
}
