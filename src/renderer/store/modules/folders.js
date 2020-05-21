import db from '@/datastore'
import electronStore from '@@/store'
import shortid from 'shortid'
import { defaultLibraryQuery } from '@/util/helpers'

export default {
  namespaced: true,
  state: {
    list: [],
    selected: null,
    selectedId: null,
    selectedIds: null,
    editableId: null
  },
  getters: {
    folders (state) {
      return state.list
    },
    selectedId (state) {
      return state.selectedId
    },
    selectedIds (state) {
      return state.selectedIds
    },
    editableId (state) {
      return state.editableId
    },
    defaultLanguage (state) {
      if (state.selected) {
        return state.selected.defaultLanguage
      }
    },
    defaultQueryBySystemFolder (state) {
      let query
      if (state.selectedId === 'trash') {
        query = { isDeleted: true }
      }
      if (state.selectedId === 'favorites') {
        query = { isFavorites: true }
      }
      if (state.selectedId === 'allSnippets') {
        query = {}
      }
      if (state.selectedId === 'inBox') {
        query = { folderId: null }
      }

      return query
    },
    isSystemFolder (state) {
      return (
        state.selectedId === 'trash' ||
        state.selectedId === 'favorites' ||
        state.selectedId === 'allSnippets' ||
        state.selectedId === 'inBox'
      )
    }
  },
  mutations: {
    SET_FOLDERS (state, data) {
      state.list = data
    },
    SET_SELECTED_ID (state, id) {
      state.selectedId = id
    },
    SET_SELECTED_IDS (state, ids) {
      state.selectedIds = ids
    },
    SET_SELECTED (state, data) {
      state.selected = data
    },
    SET_EDITABLE (state, id) {
      state.editableId = id
    }
  },
  actions: {
    getFolders ({ commit }) {
      return new Promise((resolve, reject) => {
        db.masscode.findOne({ _id: 'folders' }, (err, doc) => {
          if (err) return
          if (doc) {
            commit('SET_FOLDERS', doc.list)
            resolve()
          }
        })
      })
    },
    setSelectedFolder ({ state, commit, dispatch, getters }, id) {
      const libraryItems = ['inBox', 'favorites', 'allSnippets', 'trash']

      if (!id) {
        commit('SET_SELECTED_ID', null)
        electronStore.app.delete('selectedFolderId')
        return
      }

      commit('SET_SELECTED_ID', id)
      electronStore.app.set('selectedFolderId', id)

      if (libraryItems.includes(id)) {
        commit('SET_SELECTED', null)
        commit('SET_SELECTED_IDS', null)
        return
      }

      const { list } = state

      function findFolderById (folders, id) {
        let found
        folders.forEach(i => {
          if (i.id === id) found = i

          if (i.children && i.children.length) {
            findFolderById(i.children, id)
          }
        })

        if (found) {
          commit('SET_SELECTED', found)
        }
      }

      findFolderById(list, id)

      dispatch('setSelectedIds')
    },
    setSelectedIds ({ state, commit }) {
      if (!state.selected) return

      const ids = []

      function getIds (arr) {
        arr.forEach(i => {
          ids.push(i.id)

          if (i.children && i.children.length) {
            getIds(i.children)
          }
        })
      }

      getIds([state.selected])

      commit('SET_SELECTED_IDS', ids)
    },
    addFolder ({ state, commit, dispatch }) {
      const folder = {
        id: shortid(),
        name: 'Untitled',
        open: false,
        defaultLanguage: 'text'
      }

      db.masscode.update(
        { _id: 'folders' },
        { $push: { list: folder } },
        (err, doc) => {
          if (err) return

          commit('SET_EDITABLE', folder.id)
          commit('SET_SELECTED', folder)
          commit('SET_SELECTED_ID', folder.id)
          commit('SET_SELECTED_IDS', [folder.id])
          dispatch('getFolders')
        }
      )
    },
    updateFolderName ({ dispatch, rootGetters }, { id, payload }) {
      db.masscode.findOne({ _id: 'folders' }, (err, doc) => {
        if (err) return

        const { list } = doc

        function findAndUpdate (arr) {
          arr.forEach((i, index) => {
            if (i.id === id) {
              i.name = payload
            }

            if (i.children && i.children.length) {
              findAndUpdate(i.children)
            }
          })
        }
        findAndUpdate(list)

        const ids = rootGetters['folders/selectedIds']
        const folderId = rootGetters['folders/selectedId']
        const defaultQuery = { folderId: { $in: ids } }
        const query = defaultLibraryQuery(defaultQuery, folderId)

        dispatch('updateFolders', list)
        dispatch('snippets/getSnippets', query, { root: true })
      })
    },
    updateFolderLanguage ({ dispatch, rootGetters }, { id, payload }) {
      db.masscode.findOne({ _id: 'folders' }, async (err, doc) => {
        if (err) return

        const { list } = doc

        function findAndUpdate (arr) {
          arr.forEach((i, index) => {
            if (i.id === id) {
              i.defaultLanguage = payload
            }

            if (i.children && i.children.length) {
              findAndUpdate(i.children)
            }
          })
        }
        findAndUpdate(list)

        await dispatch('updateFolders', list)
        const folderId = rootGetters['folders/selectedId']

        if (folderId === id) {
          dispatch('setSelectedFolder', id)
        }
      })
    },
    updateFolders ({ dispatch }, list) {
      return new Promise((resolve, reject) => {
        db.masscode.update({ _id: 'folders' }, { list }, async (err, doc) => {
          if (err) return
          await dispatch('getFolders')
          resolve()
        })
      })
    },
    deleteFolder ({ state, commit, dispatch, rootGetters }, id) {
      const ids = rootGetters['folders/selectedIds']
      const folderId = rootGetters['folders/selectedId']
      const defaultQuery = { folderId: { $in: ids } }
      const query = defaultLibraryQuery(defaultQuery, folderId)
      // Перемещаем все сниппеты из удаленной папки,
      // включая вложенные сниппеты в подпапках, в корзину
      db.snippets.update(
        { folderId: { $in: ids } },
        { $set: { isDeleted: true } },
        { multi: true },
        (err, doc) => {
          if (err) return
          dispatch('snippets/getSnippets', query, { root: true })
        }
      )
      // Удаляем папку, включая все подпапки
      db.masscode.findOne({ _id: 'folders' }, (err, doc) => {
        if (err) return

        const { list } = doc

        function findAndRemove (arr) {
          arr.forEach((i, index) => {
            if (i.id === id) {
              return arr.splice(index, 1)
            }

            if (i.children && i.children.length) {
              findAndRemove(i.children)
            }
          })
        }
        findAndRemove(list)

        db.masscode.update({ _id: 'folders' }, { list }, (err, doc) => {
          if (err) return

          dispatch('getFolders')
          dispatch('snippets/setSelected', null, { root: true })
          dispatch('setSelectedFolder', 'allSnippets')
        })
      })
    }
  }
}
