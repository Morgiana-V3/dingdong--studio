// Resource families documented by TiebaArchiver; URLs stay on Baidu's static host.
export function tiebaEmoticonURL(id: string): string | undefined {
  const base = 'https://tb2.bdstatic.com/tb/editor/images/'
  const bubble = /^image_emoticon(\d{1,3})?$/.exec(id)
  if (bubble) {
    const number = Number(bubble[1] || 1)
    if (number >= 51 && number <= 61) {
      return `${base}face/i_f${number}.gif`
    }
    return `${base}client/${id}.png`
  }
  const families: Record<string, [string, string]> = {
    bearchildren_: ['bearchildren', 'gif'],
    tiexing_: ['tiexing', 'gif'],
    ali_: ['ali', 'gif'],
    llb_: ['luoluobu', 'gif'],
    b: ['qpx_n', 'gif'],
    xyj_: ['xyj', 'gif'],
    ltn_: ['lt', 'gif'],
    bfmn_: ['bfmn', 'gif'],
    pczxh_: ['zxh', 'gif'],
    t_: ['tsj', 'gif'],
    wdj_: ['wdj', 'png'],
    lxs_: ['lxs', 'gif'],
    B_: ['bobo', 'gif'],
    yz_: ['shadow', 'gif'],
    w_: ['ldw', 'gif'],
    '10th_': ['10th', 'gif'],
  }
  const match = /^(.*?)(\d{1,3})$/.exec(id)
  const family = match && families[match[1]]
  if (family) {
    return `${base}${family[0]}/${id}.${family[1]}`
  }
}
