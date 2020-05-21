import Vue from 'vue'
import Vuex from 'vuex'

import app from './modules/app'
import folders from './modules/folders'
import preferences from './modules/preferences'
import snippets from './modules/snippets'
import tags from './modules/tags'

Vue.use(Vuex)

export default new Vuex.Store({
  strict: true,
  modules: {
    app,
    folders,
    preferences,
    snippets,
    tags
  }
})
