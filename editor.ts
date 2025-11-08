// This file implements a collaborative text editor with Quill, local-first sync, and network synchronization
// using CRDT for conflict-free merging. Supports multiple documents with user presence tracking.

import { CRDTDocument } from "./crdt.js"

// Declare Quill types
declare const Quill: any

type DocumentData = {id: string, title: string, content: string, updatedAt: number}
type UserPresence = {agentId: string, name: string, color: string, cursor: number | null, docId: string | null}

const DOCUMENTS_STORAGE_KEY = 'crdt-documents'
const AGENT_ID_KEY = 'crdt-agent-id'
const USER_NAME_KEY = 'crdt-user-name'

// Generate a unique agent ID for this client
function getOrCreateAgentId(): string {
  let agentId = localStorage.getItem(AGENT_ID_KEY)
  if (!agentId) {
    agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem(AGENT_ID_KEY, agentId)
  }
  return agentId
}

// Generate a unique document ID
function generateDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Get or create user name
function getOrCreateUserName(): string {
  let userName = localStorage.getItem(USER_NAME_KEY)
  if (!userName) {
    userName = `User ${Math.random().toString(36).substr(2, 5)}`
    localStorage.setItem(USER_NAME_KEY, userName)
  }
  return userName
}

// Generate a color for a user based on their agent ID
function getUserColor(agentId: string): string {
  const colors = [
    '#1a73e8', '#ea4335', '#34a853', '#fbbc04',
    '#9c27b0', '#ff9800', '#00bcd4', '#e91e63',
    '#009688', '#3f51b5', '#ff5722', '#795548'
  ]
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

const elemById = (name: string): HTMLElement => {
  const elem = document.getElementById(name)
  if (elem == null) throw Error('Missing element ' + name)
  return elem
}

// Network synchronization manager with user presence
class NetworkSync {
  private ws: WebSocket | null = null
  private wsUrl: string
  private agentId: string
  private userName: string
  private userColor: string
  private onRemoteChange: (docId: string, data: string) => void
  private onUserPresence: (presence: UserPresence) => void
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private presenceInterval: ReturnType<typeof setInterval> | null = null
  private currentDocId: string | null = null
  private currentCursor: number | null = null

  constructor(
    wsUrl: string,
    agentId: string,
    userName: string,
    onRemoteChange: (docId: string, data: string) => void,
    onUserPresence: (presence: UserPresence) => void
  ) {
    this.wsUrl = wsUrl
    this.agentId = agentId
    this.userName = userName
    this.userColor = getUserColor(agentId)
    this.onRemoteChange = onRemoteChange
    this.onUserPresence = onUserPresence
    this.connect()
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.wsUrl)

      this.ws.onopen = () => {
        console.log('WebSocket connected')
        this.updateConnectionStatus(true)
        this.reconnectAttempts = 0
        this.startPresenceUpdates()
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data.toString())

          if (message.type === 'content') {
            const { docId, data } = message
            this.onRemoteChange(docId, data)
          } else if (message.type === 'presence') {
            this.onUserPresence(message.presence)
          }
        } catch (error) {
          console.error('Error processing message:', error)
        }
      }

      this.ws.onclose = () => {
        console.log('WebSocket disconnected')
        this.updateConnectionStatus(false)
        this.stopPresenceUpdates()
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        this.updateConnectionStatus(false)
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      this.updateConnectionStatus(false)
      if (typeof window !== 'undefined') {
        this.scheduleReconnect()
      }
    }
  }

  private startPresenceUpdates() {
    this.presenceInterval = setInterval(() => {
      this.sendPresence()
    }, 1000) // Send presence every second
  }

  private stopPresenceUpdates() {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval)
      this.presenceInterval = null
    }
  }

  private sendPresence() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'presence',
        presence: {
          agentId: this.agentId,
          name: this.userName,
          color: this.userColor,
          cursor: this.currentCursor,
          docId: this.currentDocId
        }
      })
      this.ws.send(message)
    }
  }

  updateCursor(docId: string | null, cursor: number | null) {
    this.currentDocId = docId
    this.currentCursor = cursor
    this.sendPresence()
  }

  sendContent(docId: string, data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'content',
        docId,
        data
      })
      this.ws.send(message)
      return true
    }
    return false
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached')
      return
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++

    this.reconnectTimeout = setTimeout(() => {
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`)
      this.connect()
    }, delay)
  }

  private updateConnectionStatus(connected: boolean) {
    try {
      const statusElem = elemById('connection-status')
      if (connected) {
        statusElem.textContent = 'Connected'
        statusElem.className = 'connected'
      } else {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          statusElem.textContent = 'Offline'
        } else {
          statusElem.textContent = 'Disconnected'
        }
        statusElem.className = 'disconnected'
      }
    } catch (error) {
      console.error('Failed to update connection status:', error)
    }
  }

  disconnect() {
    this.stopPresenceUpdates()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Document Manager with Quill integration
class DocumentManager {
  private documents: Map<string, {doc: CRDTDocument, title: string, updatedAt: number}> = new Map()
  private currentDocumentId: string | null = null
  private agentId: string
  private userName: string
  private networkSync: NetworkSync
  private quill: any = null
  private isUpdating: boolean = false
  private remoteUsers: Map<string, UserPresence> = new Map()

  constructor(agentId: string, userName: string) {
    this.agentId = agentId
    this.userName = userName

    // Setup network sync
    const isNgrok = window.location.hostname.includes('ngrok') ||
                    window.location.hostname.includes('ngrok-free.app') ||
                    window.location.hostname.includes('ngrok.io')

    let wsUrl: string
    if (isNgrok) {
      wsUrl = `wss://${window.location.hostname}/ws`
    } else {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsHost = window.location.hostname
      const wsPort = '3002'
      wsUrl = `${wsProtocol}//${wsHost}:${wsPort}`
    }

    this.networkSync = new NetworkSync(
      wsUrl,
      agentId,
      userName,
      (docId: string, remoteData: string) => this.handleRemoteChange(docId, remoteData),
      (presence: UserPresence) => this.handleUserPresence(presence)
    )

    // Initialize Quill
    this.initQuill()

    // Load documents from localStorage
    this.loadDocuments()

    // If no documents, create a default one
    if (this.documents.size === 0) {
      this.createDocument('Untitled Document')
    } else {
      const firstDocId = Array.from(this.documents.keys())[0]
      this.switchDocument(firstDocId)
    }
  }

  private initQuill() {
    const editorElem = elemById('editor')
    this.quill = new Quill(editorElem, {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['link', 'blockquote', 'code-block'],
          ['clean']
        ]
      },
      placeholder: 'Start typing... Changes sync automatically'
    })

    // Track text changes and cursor position
    this.quill.on('text-change', (delta: any, oldDelta: any, source: string) => {
      if (source === 'user' && !this.isUpdating && this.currentDocumentId) {
        this.handleTextChange(delta)
      }
    })

    this.quill.on('selection-change', (range: any) => {
      if (this.currentDocumentId) {
        const cursor = range ? range.index : null
        this.networkSync.updateCursor(this.currentDocumentId, cursor)
      }
    })
  }

  private handleTextChange(delta: any) {
    if (!this.currentDocumentId) return

    const document = this.documents.get(this.currentDocumentId)
    if (!document) return

    // Convert Quill delta to CRDT operations
    const text = this.quill.getText()
    const oldText = document.doc.getString()

    // Simple diff-based approach (can be improved with delta operations)
    const diff = this.calcDiff(oldText, text)

    if (diff.del > 0) {
      document.doc.del(diff.pos, diff.del)
    }
    if (diff.ins !== '') {
      document.doc.ins(diff.pos, diff.ins)
    }

    document.updatedAt = Date.now()

    // LOCAL-FIRST: Save immediately
    this.saveDocuments()
    this.updateDocumentList()

    // Sync over network (debounced)
    this.debouncedNetworkSync()
  }

  private calcDiff(oldval: string, newval: string): {pos: number, del: number, ins: string} {
    if (oldval === newval) return {pos: 0, del: 0, ins: ''}

    let oldChars = [...oldval]
    let newChars = [...newval]

    var commonStart = 0;
    while (oldChars[commonStart] === newChars[commonStart]) {
      commonStart++;
    }

    var commonEnd = 0;
    while (oldChars[oldChars.length - 1 - commonEnd] === newChars[newChars.length - 1 - commonEnd] &&
        commonEnd + commonStart < oldChars.length && commonEnd + commonStart < newChars.length) {
      commonEnd++;
    }

    const del = (oldChars.length !== commonStart + commonEnd)
      ? oldChars.length - commonStart - commonEnd
      : 0
    const ins = (newChars.length !== commonStart + commonEnd)
      ? newChars.slice(commonStart, newChars.length - commonEnd).join('')
      : ''

    return { pos: commonStart, del, ins }
  }

  private networkSyncTimeout: ReturnType<typeof setTimeout> | null = null
  private debouncedNetworkSync() {
    if (this.networkSyncTimeout) clearTimeout(this.networkSyncTimeout)
    this.networkSyncTimeout = setTimeout(() => {
      if (this.currentDocumentId) {
        const document = this.documents.get(this.currentDocumentId)
        if (document) {
          const serialized = document.doc.serialize()
          const sent = this.networkSync.sendContent(this.currentDocumentId, serialized)
          if (sent) {
            const syncStatus = elemById('sync-status')
            syncStatus.textContent = 'Syncing...'
          }
        }
      }
    }, 300)
  }

  private handleRemoteChange(docId: string, remoteData: string) {
    let document = this.documents.get(docId)

    if (!document) {
      // Document doesn't exist locally, create it
      const remoteDoc = CRDTDocument.deserialize('remote', remoteData)
      this.documents.set(docId, {
        doc: remoteDoc,
        title: 'Untitled Document',
        updatedAt: Date.now()
      })
      this.updateDocumentList()
      if (this.currentDocumentId === docId) {
        this.loadDocumentIntoEditor(docId)
      }
      return
    }

    try {
      const remoteDoc = CRDTDocument.deserialize('remote', remoteData)
      const tempDoc = document.doc.clone()
      tempDoc.mergeFrom(remoteDoc)

      document.doc.inner = tempDoc.inner
      document.updatedAt = Date.now()

      if (this.currentDocumentId === docId) {
        this.loadDocumentIntoEditor(docId)
      }

      this.saveDocuments()
      this.updateDocumentList()

      const syncStatus = elemById('sync-status')
      syncStatus.textContent = 'Synced'
      setTimeout(() => {
        syncStatus.textContent = 'Ready'
      }, 1000)
    } catch (error) {
      console.error('Failed to merge remote change:', error)
    }
  }

  private handleUserPresence(presence: UserPresence) {
    // Ignore our own presence
    if (presence.agentId === this.agentId) return

    if (presence.docId === this.currentDocumentId && presence.cursor !== null) {
      this.remoteUsers.set(presence.agentId, presence)
      this.updateUserCursors()
    } else {
      this.remoteUsers.delete(presence.agentId)
      this.updateUserCursors()
    }

    this.updateUsersList()
  }

  private updateUserCursors() {
    const overlay = elemById('collaboration-overlay')
    overlay.innerHTML = ''

    if (!this.currentDocumentId) return

    this.remoteUsers.forEach((presence) => {
      if (presence.cursor === null || presence.docId !== this.currentDocumentId) return

      try {
        const bounds = this.quill.getBounds(presence.cursor, 0)
        if (bounds) {
          // Get the editor container position
          const editorContainer = this.quill.container
          const containerRect = editorContainer.getBoundingClientRect()
          const editorRect = elemById('editor-container').getBoundingClientRect()

          // Calculate position relative to overlay
          const left = bounds.left + (containerRect.left - editorRect.left)
          const top = bounds.top + (containerRect.top - editorRect.top) - editorContainer.scrollTop

          const cursorElem = document.createElement('div')
          cursorElem.className = 'user-cursor'
          cursorElem.style.left = `${left}px`
          cursorElem.style.top = `${top}px`
          cursorElem.style.color = presence.color

          const line = document.createElement('div')
          line.className = 'user-cursor-line'
          line.style.backgroundColor = presence.color
          line.style.width = '2px'
          line.style.height = `${bounds.height || 20}px`

          const label = document.createElement('div')
          label.className = 'user-cursor-label'
          label.textContent = presence.name
          label.style.backgroundColor = presence.color

          cursorElem.appendChild(line)
          cursorElem.appendChild(label)
          overlay.appendChild(cursorElem)
        }
      } catch (error) {
        // Cursor position might be invalid
      }
    })
  }

  private updateUsersList() {
    const container = elemById('users-container')
    container.innerHTML = ''

    // Add current user
    const currentUser = document.createElement('div')
    currentUser.className = 'user-item'
    currentUser.innerHTML = `
      <div class="user-avatar" style="background-color: ${getUserColor(this.agentId)}">
        ${this.userName.charAt(0).toUpperCase()}
      </div>
      <div class="user-name">${this.userName} (You)</div>
    `
    container.appendChild(currentUser)

    // Add remote users
    this.remoteUsers.forEach((presence) => {
      if (presence.docId === this.currentDocumentId) {
        const userItem = document.createElement('div')
        userItem.className = 'user-item'
        userItem.innerHTML = `
          <div class="user-avatar" style="background-color: ${presence.color}">
            ${presence.name.charAt(0).toUpperCase()}
          </div>
          <div class="user-name">${presence.name}</div>
          <div class="user-cursor-indicator" style="color: ${presence.color}"></div>
        `
        container.appendChild(userItem)
      }
    })
  }

  private loadDocuments() {
    try {
      const stored = localStorage.getItem(DOCUMENTS_STORAGE_KEY)
      if (stored) {
        const docs: DocumentData[] = JSON.parse(stored)
        docs.forEach(docData => {
          const doc = CRDTDocument.deserialize(this.agentId, docData.content)
          this.documents.set(docData.id, {
            doc,
            title: docData.title,
            updatedAt: docData.updatedAt
          })
        })
        console.log(`Loaded ${this.documents.size} documents from localStorage`)
      }
    } catch (error) {
      console.error('Failed to load documents:', error)
    }
  }

  private saveDocuments() {
    try {
      const docs: DocumentData[] = Array.from(this.documents.entries()).map(([id, {doc, title, updatedAt}]) => ({
        id,
        title,
        content: doc.serialize(),
        updatedAt
      }))
      localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docs))
      console.log('Saved documents to localStorage')
    } catch (error) {
      console.error('Failed to save documents:', error)
    }
  }

  createDocument(title: string = 'Untitled Document'): string {
    const id = generateDocumentId()
    const doc = new CRDTDocument(this.agentId)
    this.documents.set(id, {
      doc,
      title,
      updatedAt: Date.now()
    })
    this.saveDocuments()
    this.updateDocumentList()
    this.switchDocument(id)
    return id
  }

  deleteDocument(id: string) {
    if (this.documents.size <= 1) {
      alert('Cannot delete the last document. Create a new one first.')
      return
    }

    if (confirm('Are you sure you want to delete this document?')) {
      this.documents.delete(id)
      this.saveDocuments()
      this.updateDocumentList()

      if (this.currentDocumentId === id) {
        const firstDocId = Array.from(this.documents.keys())[0]
        this.switchDocument(firstDocId)
      }
    }
  }

  renameDocument(id: string, newTitle: string) {
    const document = this.documents.get(id)
    if (document) {
      document.title = newTitle || 'Untitled Document'
      document.updatedAt = Date.now()
      this.saveDocuments()
      this.updateDocumentList()
      if (this.currentDocumentId === id) {
        this.updateDocumentTitle(newTitle)
      }
    }
  }

  switchDocument(id: string) {
    const document = this.documents.get(id)
    if (!document) return

    this.currentDocumentId = id
    this.loadDocumentIntoEditor(id)
    this.updateDocumentTitle(document.title)
    this.updateDocumentList()
    this.networkSync.updateCursor(id, this.quill.getSelection()?.index || null)
  }

  private loadDocumentIntoEditor(id: string) {
    const document = this.documents.get(id)
    if (!document) return

    this.isUpdating = true
    const text = document.doc.getString()
    this.quill.setText(text)
    this.isUpdating = false
  }

  private updateDocumentTitle(title: string) {
    const titleElem = elemById('document-title')
    titleElem.textContent = title
  }

  private updateDocumentList() {
    const listElem = elemById('document-list')
    listElem.innerHTML = ''

    if (this.documents.size === 0) {
      listElem.innerHTML = '<div class="document-item-empty">No documents</div>'
      return
    }

    const sortedDocs = Array.from(this.documents.entries())
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)

    sortedDocs.forEach(([id, {doc, title, updatedAt}]) => {
      const item = document.createElement('div')
      item.className = `document-item ${id === this.currentDocumentId ? 'active' : ''}`
      item.onclick = () => this.switchDocument(id)

      const titleDiv = document.createElement('div')
      titleDiv.className = 'document-item-title'
      titleDiv.textContent = title

      const previewDiv = document.createElement('div')
      previewDiv.className = 'document-item-preview'
      const content = doc.getString()
      previewDiv.textContent = content.substring(0, 50) || 'Empty document'

      item.appendChild(titleDiv)
      item.appendChild(previewDiv)
      listElem.appendChild(item)
    })
  }

  getCurrentDocumentId(): string | null {
    return this.currentDocumentId
  }

  getCurrentDocumentTitle(): string {
    if (!this.currentDocumentId) return 'Untitled Document'
    const document = this.documents.get(this.currentDocumentId)
    return document ? document.title : 'Untitled Document'
  }

  disconnect() {
    this.networkSync.disconnect()
  }
}

window.onload = () => {
  const agentId = getOrCreateAgentId()
  const userName = getOrCreateUserName()
  console.log('Agent ID:', agentId)
  console.log('User Name:', userName)

  const docManager = new DocumentManager(agentId, userName)

  // UI Event Handlers
  elemById('new-document-btn').onclick = () => {
    const title = prompt('Enter document title:', 'Untitled Document')
    if (title !== null) {
      docManager.createDocument(title || 'Untitled Document')
    }
  }

  elemById('delete-document-btn').onclick = () => {
    const currentId = docManager.getCurrentDocumentId()
    if (currentId) {
      docManager.deleteDocument(currentId)
    }
  }

  elemById('rename-document-btn').onclick = () => {
    const currentId = docManager.getCurrentDocumentId()
    if (currentId) {
      const currentTitle = docManager.getCurrentDocumentTitle()
      const newTitle = prompt('Enter new title:', currentTitle)
      if (newTitle !== null) {
        docManager.renameDocument(currentId, newTitle || 'Untitled Document')
      }
    }
  }

  // Update cursor positions periodically and on scroll
  const updateCursors = () => {
    if (docManager.getCurrentDocumentId()) {
      const selection = (docManager as any).quill.getSelection()
      const cursor = selection ? selection.index : null
      ;(docManager as any).networkSync.updateCursor(
        docManager.getCurrentDocumentId(),
        cursor
      )
      ;(docManager as any).updateUserCursors()
    }
  }

  setInterval(updateCursors, 200)

  // Update cursors on scroll
  const editorElem = elemById('editor')
  editorElem.addEventListener('scroll', updateCursors)

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    docManager.disconnect()
  })

  console.log('Editor initialized with Quill and user presence tracking!')
}
