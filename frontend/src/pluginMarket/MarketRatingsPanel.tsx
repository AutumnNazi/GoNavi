import { useState } from 'react';
import { Alert, Button, Input, Pagination, Popconfirm, Rate, Space, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import type { MarketRating } from './types';

interface Props {
  ratings: MarketRating[];
  authenticated: boolean;
  busy: boolean;
  onSave: (stars: number, body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}
export function MarketRatingsPanel({ ratings, authenticated, busy, onSave, onDelete }: Props) {
  const { t } = useI18n();
  const [stars, setStars] = useState(0);
  const [body, setBody] = useState('');
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(ratings.length / 10)));
  return <section className="plugin-stack" aria-label={t('plugin.market.ratings')}>
    <Typography.Title level={5}>{t('plugin.market.ratings')}</Typography.Title>
    {ratings.length === 0 && <Typography.Text type="secondary">{t('plugin.market.no_ratings')}</Typography.Text>}
    {ratings.slice((currentPage - 1) * 10, currentPage * 10).map((rating) => <article className="plugin-rating" key={rating.userId}>
      <div className="plugin-toolbar"><Typography.Text>{rating.userId}</Typography.Text><Rate disabled value={rating.stars} /></div>
      <Typography.Text type="secondary">{rating.version} · {rating.updatedAt}</Typography.Text>
      <p className="plugin-rating-body">{rating.body}</p>
    </article>)}
    {ratings.length > 10 && <Pagination current={currentPage} onChange={setPage} total={ratings.length} pageSize={10} showSizeChanger={false} />}
    {authenticated ? <div className="plugin-stack">
      <Typography.Text strong>{t('plugin.market.your_rating')}</Typography.Text>
      <Rate aria-label={t('plugin.market.your_rating')} value={stars} onChange={setStars} disabled={busy} />
      <Input.TextArea aria-label={t('plugin.market.review')} value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} disabled={busy} autoSize={{ minRows: 2, maxRows: 6 }} />
      <Typography.Text type="secondary">{t('plugin.market.rating_policy')}</Typography.Text>
      <Space wrap><Button onClick={() => void onSave(stars, body)} disabled={!stars || busy}>{t('plugin.market.save_rating')}</Button>
        <Popconfirm title={t('plugin.market.delete_rating_confirm')} onConfirm={() => void onDelete()} okText={t('plugin.market.delete_rating')} cancelText={t('common.cancel')}>
          <Button danger disabled={busy}>{t('plugin.market.delete_rating')}</Button>
        </Popconfirm></Space>
    </div> : <Alert type="info" message={t('plugin.market.rating_sign_in')} />}
  </section>;
}
