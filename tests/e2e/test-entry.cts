import { Xiaohongshu } from '../../src/xiaohongshu.cjs'
import { accountId as xhsAccountId, xhsNote, xhsModel } from '../helpers/xhs-fixtures.cjs'
import { Engine } from '../../src/engine.cjs'
import { XSourceService } from '../../src/x.cjs'
import { xPost, xModel } from '../helpers/x-fixtures.cjs'
import { Tieba } from '../../src/tieba.cjs'
import { modelResponse } from '../helpers/tool-model.cjs'
import { Services } from '../../src/services.cjs'
import { Bilibili } from '../../src/bilibili.cjs'

Services.prototype.send = async function send(_channel, _message, _signal, delivery) {
  delivery?.onStatus('queued')
  return '测试接收器已接受消息'
}
if (process.env.MINIPUSH_DINGDONG_TEST) {
  Services.prototype.deliveryStatus = async () => 'received'
}
Services.prototype.generate = async function generate() {
  return 'AI 统一接口测试成功'
}
if (process.env.MINIPUSH_MODEL_TEST) {
  Services.prototype.listModels = async function listModels(input) {
    this.providerConnection(input)
    if (input.key === 'bad-key') {
      throw new Error('服务返回 HTTP 401（invalid_api_key）')
    }
    return ['gpt-4.1-mini', 'gpt-test', 'image-test']
  }
}
if (process.env.MINIPUSH_XHS_TEST) {
  let loggedIn = false
  Xiaohongshu.prototype.login = async () => {
    loggedIn = true
  }
  Xiaohongshu.prototype.logout = async () => {
    loggedIn = false
  }
  Xiaohongshu.prototype.account = async () =>
    loggedIn ? { loggedIn: true, id: xhsAccountId, name: '测试小红书账号' } : { loggedIn: false }
  Xiaohongshu.prototype.feed = async () => {
    if (!loggedIn) throw new Error('小红书登录已失效')
    return { notes: [xhsNote()], scope: '测试推荐流' }
  }
  Xiaohongshu.prototype.search = async () => {
    if (!loggedIn) throw new Error('小红书登录已失效')
    return { notes: [xhsNote()], scope: '测试搜索' }
  }
  Xiaohongshu.prototype.detail = async (input) => {
    if (!loggedIn) throw new Error('小红书登录已失效')
    return xhsNote({ id: input.id })
  }
  Services.prototype.respond = async (_id, request) => xhsModel(request)
}
if (process.env.MINIPUSH_BILIBILI_TEST) {
  let loggedIn = false
  const profile = { loggedIn: true, mid: '100', name: '测试 B 站账号' }
  Bilibili.prototype.login = async () => {
    loggedIn = true
  }
  Bilibili.prototype.logout = async () => {
    loggedIn = false
  }
  Bilibili.prototype.account = async () => (loggedIn ? profile : { loggedIn: false })
  Bilibili.prototype.followings = async () => ({
    account: profile,
    users: [
      { mid: '200', name: '科技 UP', description: '' },
      { mid: '300', name: '编程 UP', description: '' },
    ],
    total: 2,
    page: 1,
    hasMore: false,
  })
  Bilibili.prototype.feed = async function feed(input) {
    await this.requireAccount(input.accountMid)
    return {
      complete: true,
      videos: [
        {
          id: 'BVfixture1',
          authorId: '200',
          author: '科技 UP',
          title: '新的 AI 工具',
          description: '这是测试简介',
          publishedAt: Date.now(),
          url: 'https://www.bilibili.com/video/BVfixture1',
        },
      ],
    }
  }
}
if (process.env.MINIPUSH_TIEBA_TEST) {
  Tieba.prototype.search = async () => ({ mode: 'interests', entries: [] })
  Tieba.prototype.post = async ({ id }) => ({
    id,
    body: '楼主首楼的原始表达，不是 AI 摘要。',
    author: '测试楼主',
    images: ['https://tiebapic.baidu.com/forum/test.jpg'],
  })
  Tieba.prototype.feed = async (input) => {
    if (input.target === '失败') {
      throw new Error('贴吧连接失败或超时')
    }
    return {
      mode: 'interests',
      scopeDescription: '当前候选样本',
      entries: [
        {
          id: input.target === 'macmini' ? '23456' : '12345',
          title: input.target === 'macmini' ? '硬件散热评测' : '动画角色讨论',
          body: '人物成长分析',
          replyCount: 25,
          createdAt: 1000,
          images: ['https://tiebapic.baidu.com/forum/test.jpg'],
          url: 'https://tieba.baidu.com/p/12345',
        },
        {
          id: '67890',
          title: '二手电脑出售',
          body: '出售电脑',
          replyCount: 10,
          createdAt: 1000,
          url: 'https://tieba.baidu.com/p/67890',
        },
      ],
    }
  }
  Services.prototype.respond = async (_provider, request) => {
    return modelResponse(request, {
      conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }],
      readFirst: true,
      choose: (candidates, rules) =>
        rules.globalFilter === '无匹配'
          ? []
          : candidates.filter((entry) =>
              entry.title.includes((rules.forumFilter || '').includes('硬件') ? '硬件' : '动画'),
            ),
    })
  }
}
if (process.env.MINIPUSH_X_TEST) {
  XSourceService.prototype.following = async () => ({
    posts: [xPost()],
    query: '',
    scope: '关注首批',
  })
  let loggedIn = false
  XSourceService.prototype.login = async () => {
    loggedIn = true
  }
  XSourceService.prototype.importChromeSession = async () => {
    loggedIn = true
  }
  XSourceService.prototype.loginChrome = async () => {
    loggedIn = true
  }
  XSourceService.prototype.logout = async () => {
    loggedIn = false
  }
  XSourceService.prototype.refreshSession = async () =>
    loggedIn ? { hasSession: true, id: '100' } : { hasSession: false }
  XSourceService.prototype.account = async () =>
    loggedIn ? { hasSession: true, id: '100' } : { hasSession: false }
  XSourceService.prototype.search = async (input) => {
    if (!loggedIn) {
      throw new Error('请先登录 X')
    }
    if (input.query === '失败') {
      throw new Error('X 搜索限流')
    }
    return {
      posts: [xPost(), xPost({ id: '2', text: '不符合互动条件', replyCount: 20 })],
      query: input.query,
      scope: '首批结果',
    }
  }
  XSourceService.prototype.detail = async () => ({ post: xPost(), thread: [], scope: '讨论串片段' })
  Services.prototype.respond = async (_provider, request) => xModel(request)
}
if (process.env.MINIPUSH_DIGEST_FAILURE_TEST) {
  const execute = Engine.prototype.execute
  Engine.prototype.execute = function (plugin, task, controller, trace) {
    if (task.config.body === '模拟来源失败') return Promise.reject(new Error('测试来源暂时不可用'))
    return execute.call(this, plugin, task, controller, trace)
  }
}
require('../../src/main.cjs')
